import { parse } from 'tldts';

import { normalizeHost } from '@/helpers/domain';
import type { SocksProxy } from '@/helpers/socksProxy/socksProxies.types';
import type {
  ProxyDetails,
  ProxyDetailsMap,
  ProxyInfo,
  ProxyInfoMap,
} from '@/helpers/socksProxy/socksProxy.types';

/**
 * Chrome has no `proxy.onRequest`, so the extension state is compiled into a PAC script that is
 * applied with `chrome.proxy.settings`. The routing logic is a plain JS string (PAC_RUNTIME) so
 * the emitted script doesn't depend on how the bundler transforms TS functions.
 */

export type ProxyState = {
  excludedHosts: string[];
  globalProxy: Partial<ProxyInfo>;
  globalProxyDetails: Partial<ProxyDetails>;
  hostProxies: ProxyInfoMap;
  hostProxiesDetails: ProxyDetailsMap;
  randomProxyMode: boolean;
  flatProxiesList: SocksProxy[];
  randomSeed: string;
};

export type PacHostRule = {
  // normalized host (lowercase, punycode)
  h: string;
  // whether subdomains of `h` match too (i.e. `h` is a registrable domain)
  s: boolean;
  // PAC result, e.g. "SOCKS 10.64.0.1:1080"
  p?: string;
};

export type PacRules = {
  random: boolean;
  // [relay hostname, PAC result], sorted by hostname
  randomList: [string, string][];
  seed: string;
  excluded: PacHostRule[];
  hosts: PacHostRule[];
  global: string | null;
};

export type CompiledPac = {
  rules: PacRules;
  // whether the extension needs to control the proxy settings at all
  active: boolean;
  // configuration problems; affected rules fail closed (PAC_BLOCK) or are skipped
  issues: string[];
};

// Returned when a proxy is required but can't be used: fail closed instead of going direct.
export const PAC_BLOCK = 'SOCKS5 127.0.0.1:9';

// The Mullvad API must stay reachable in random mode before the relay list is known,
// otherwise the list could never be fetched.
export const RELAY_LIST_HOST = 'api.mullvad.net';

const isValidPort = (port: unknown): port is number =>
  typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;

/** PAC result for a proxy, or null if it is incomplete/invalid. */
export const toPacProxy = (proxy?: Partial<ProxyInfo>): string | null => {
  if (!proxy || typeof proxy !== 'object') return null;
  if (proxy.type !== 'socks' && proxy.type !== 'socks4') return null;
  const host = typeof proxy.host === 'string' ? normalizeHost(proxy.host) : null;
  if (!host) return null;
  if (!isValidPort(proxy.port)) return null;
  // Always "SOCKS" (SOCKS4): Chrome resolves the site locally (its own resolver, e.g. Mullvad DNS
  // or DoH) and sends the IP to the relay. With "SOCKS5" Chrome always leaves DNS to the relay,
  // and Mullvad relay resolvers intermittently fail (SERVFAIL/timeouts) for some domains, which
  // breaks those sites (e.g. x.com's twimg.com CDN) while they work without the proxy.
  // Mullvad relays accept SOCKS4; IPv6-only sites can't be reached through it.
  return `SOCKS ${host.includes(':') ? `[${host}]` : host}:${proxy.port}`;
};

// A configured host also matches its subdomains when it is a registrable domain,
// mirroring the Firefox logic (exact host, then registrable domain of the requested host).
const isRegistrableDomain = (host: string) => parse(host).domain === host;

export const compilePacRules = (state: ProxyState): CompiledPac => {
  const issues: string[] = [];

  const hosts: PacHostRule[] = [];
  for (const [key, details] of Object.entries(state.hostProxiesDetails ?? {})) {
    if (!details?.socksEnabled) continue;
    const h = normalizeHost(key);
    if (!h) {
      issues.push(`Invalid site "${key}" ignored`);
      continue;
    }
    let p = toPacProxy(state.hostProxies?.[key]);
    if (!p) {
      issues.push(`Invalid proxy for ${h}: its traffic is blocked`);
      p = PAC_BLOCK;
    }
    hosts.push({ h, s: isRegistrableDomain(h), p });
  }

  const excluded: PacHostRule[] = [];
  for (const key of state.excludedHosts ?? []) {
    const h = normalizeHost(key);
    if (h) excluded.push({ h, s: isRegistrableDomain(h) });
    else issues.push(`Invalid excluded site "${String(key)}" ignored`);
  }

  let global: string | null = null;
  if (state.globalProxyDetails?.socksEnabled) {
    global = toPacProxy(state.globalProxy);
    if (!global) {
      issues.push('Invalid proxy for all websites: traffic is blocked');
      global = PAC_BLOCK;
    }
  }

  const randomList = (state.flatProxiesList ?? [])
    .map((relay): [string, string | null] => [
      String(relay?.hostname ?? ''),
      toPacProxy({
        type: 'socks' as ProxyInfo['type'],
        host: relay?.ipv4_address,
        port: relay?.port,
      }),
    ])
    .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const random = state.randomProxyMode === true;
  if (random && randomList.length === 0) {
    issues.push('Random mode: the proxy list is not loaded yet, traffic is blocked');
  }

  return {
    rules: { random, randomList, seed: state.randomSeed, excluded, hosts, global },
    active: random || global !== null || hosts.length > 0,
    issues,
  };
};

/** Self-contained PAC routing logic, evaluated by Chrome (expects a global RULES object). */
export const PAC_RUNTIME = String.raw`
function isLocal(h) {
  if (h === 'localhost') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    var o = h.split('.').map(Number);
    return (
      o[0] === 10 ||
      o[0] === 127 ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] >= 224 && o[0] <= 239)
    );
  }
  if (h.indexOf(':') !== -1) {
    return h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || /^ff/.test(h);
  }
  return false;
}

// Approximation of the registrable domain (no Public Suffix List in PAC), only used to keep
// the random proxy stable for all subdomains of a site.
function siteOf(h) {
  if (h.indexOf(':') !== -1 || /^[\d.]+$/.test(h)) return h;
  var l = h.split('.');
  if (l.length <= 2) return h;
  var twoLevel = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gv'];
  var n = l[l.length - 1].length === 2 && twoLevel.indexOf(l[l.length - 2]) !== -1 ? 3 : 2;
  return l.slice(-n).join('.');
}

function hash(s) {
  var x = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  // final avalanche (murmur3 fmix32) so similar inputs spread well
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

// Rendezvous hashing: the relay with the highest score wins, so a site only moves to another
// relay if its relay disappears from the list (not when unrelated relays come or go).
function pickRandom(site) {
  var best = -1;
  var result = null;
  for (var i = 0; i < RULES.randomList.length; i++) {
    var score = hash(RULES.seed + '|' + site + '|' + RULES.randomList[i][0]);
    if (score > best) {
      best = score;
      result = RULES.randomList[i][1];
    }
  }
  return result;
}

function findRule(list, host) {
  var i;
  for (i = 0; i < list.length; i++) if (list[i].h === host) return list[i];
  for (i = 0; i < list.length; i++) {
    var r = list[i];
    if (r.s && host.length > r.h.length && host.slice(-r.h.length - 1) === '.' + r.h) return r;
  }
  return null;
}

function FindProxyForURL(url, rawHost) {
  var host = String(rawHost).toLowerCase();
  if (host.charAt(0) === '[') host = host.slice(1, -1);
  if (host.charAt(host.length - 1) === '.') host = host.slice(0, -1);

  // 1. Local/reserved addresses are never proxied
  if (isLocal(host)) return 'DIRECT';

  // 2. Random mode overrides everything else, stable per site for the browser session
  if (RULES.random) {
    if (!RULES.randomList.length) return host === RELAY_LIST_HOST ? 'DIRECT' : PAC_BLOCK;
    return pickRandom(siteOf(host));
  }

  // 3. Never proxy
  if (findRule(RULES.excluded, host)) return 'DIRECT';

  // 4. Host / parent domain proxy
  var hostRule = findRule(RULES.hosts, host);
  if (hostRule && hostRule.p) return hostRule.p;

  // 5. Global proxy
  if (RULES.global) return RULES.global;

  return 'DIRECT';
}
`;

export const buildPacScript = (rules: PacRules): string =>
  [
    '// Generated by the Mullvad Browser Extension',
    `var RULES = ${JSON.stringify(rules)};`,
    `var PAC_BLOCK = ${JSON.stringify(PAC_BLOCK)};`,
    `var RELAY_LIST_HOST = ${JSON.stringify(RELAY_LIST_HOST)};`,
    PAC_RUNTIME,
  ].join('\n');

/** PAC used when the stored settings can't be compiled: block everything (fail closed). */
export const BLOCK_ALL_PAC = `// Mullvad Browser Extension: settings error, all traffic blocked\nfunction FindProxyForURL(url, host) { return ${JSON.stringify(PAC_BLOCK)}; }`;
