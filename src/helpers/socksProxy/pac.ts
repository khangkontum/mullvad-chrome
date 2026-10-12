import { parse } from 'tldts';

import type { SocksProxy } from '@/helpers/socksProxy/socksProxies.types';
import type {
  ProxyDetails,
  ProxyDetailsMap,
  ProxyInfo,
  ProxyInfoMap,
} from '@/helpers/socksProxy/socksProxy.types';

/**
 * Chrome has no `proxy.onRequest`, so the extension state is compiled into a PAC script that is
 * applied with `chrome.proxy.settings`. The routing decision lives in `pacFindProxy`, which is
 * serialised verbatim into the PAC script, and is also callable from TS (tests, badge).
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
  // host as configured by the user
  h: string;
  // whether subdomains of `h` match too (i.e. `h` is a registrable domain)
  s: boolean;
  // PAC result, e.g. "SOCKS5 10.64.0.1:1080"
  p?: string;
};

export type PacRules = {
  random: boolean;
  randomList: string[];
  seed: string;
  excluded: PacHostRule[];
  hosts: PacHostRule[];
  global: string | null;
};

// Returned when a proxy is required but can't be determined: fail closed instead of going direct.
export const PAC_BLOCK = 'SOCKS5 127.0.0.1:9';

export const toPacProxy = (proxy?: Partial<ProxyInfo>): string | null => {
  if (!proxy?.host || !proxy.port) return null;
  // Chrome always resolves hostnames on the proxy side for SOCKS5 (remote DNS).
  const scheme = proxy.type === 'socks4' ? 'SOCKS' : 'SOCKS5';
  return `${scheme} ${proxy.host}:${proxy.port}`;
};

// A configured host also matches its subdomains when it is a registrable domain,
// mirroring the Firefox logic (exact host, then registrable domain of the requested host).
const isRegistrableDomain = (host: string) => parse(host).domain === host;

export const compilePacRules = (state: ProxyState): PacRules => {
  const hosts: PacHostRule[] = [];
  for (const [host, details] of Object.entries(state.hostProxiesDetails ?? {})) {
    const p = toPacProxy(state.hostProxies?.[host]);
    if (details?.socksEnabled && p) {
      hosts.push({ h: host, s: isRegistrableDomain(host), p });
    }
  }

  return {
    random: Boolean(state.randomProxyMode),
    randomList: (state.flatProxiesList ?? [])
      .map((proxy) => toPacProxy({ host: proxy.ipv4_address, port: proxy.port }))
      .filter((p): p is string => Boolean(p)),
    seed: state.randomSeed,
    excluded: (state.excludedHosts ?? []).map((h) => ({ h, s: isRegistrableDomain(h) })),
    hosts,
    global: state.globalProxyDetails?.socksEnabled ? toPacProxy(state.globalProxy) : null,
  };
};

/**
 * Routing decision. MUST stay self-contained (no references to anything outside the function
 * body) since its source is embedded in the PAC script (evaluated by V8 on Chrome).
 */
export function pacFindProxy(R: PacRules, rawHost: string): string {
  let host = String(rawHost).toLowerCase();
  if (host.charAt(0) === '[') host = host.slice(1, -1);
  if (host.charAt(host.length - 1) === '.') host = host.slice(0, -1);

  function isLocal(h: string) {
    if (h === 'localhost') return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const o = h.split('.').map(Number);
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

  // Approximation of the registrable domain (no Public Suffix List in PAC), only used to
  // keep the random proxy stable for all subdomains of a site.
  function siteOf(h: string) {
    if (h.indexOf(':') !== -1 || /^[\d.]+$/.test(h)) return h;
    const l = h.split('.');
    if (l.length <= 2) return h;
    const sld = l[l.length - 2];
    const twoLevel = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gv'];
    const n = l[l.length - 1].length === 2 && twoLevel.indexOf(sld) !== -1 ? 3 : 2;
    return l.slice(-n).join('.');
  }

  function hash(s: string) {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      x ^= s.charCodeAt(i);
      x = Math.imul(x, 0x01000193);
    }
    return x >>> 0;
  }

  function find(list: PacHostRule[]) {
    let i;
    for (i = 0; i < list.length; i++) if (list[i].h === host) return list[i];
    for (i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.s && host.length > r.h.length && host.slice(-r.h.length - 1) === '.' + r.h) return r;
    }
    return null;
  }

  // 1. Local/reserved addresses are never proxied
  if (isLocal(host)) return 'DIRECT';

  // 2. Random mode overrides everything else, stable per site for the browser session
  if (R.random) {
    if (!R.randomList.length) return 'SOCKS5 127.0.0.1:9';
    return R.randomList[hash(R.seed + '|' + siteOf(host)) % R.randomList.length];
  }

  // 3. Never proxy
  if (find(R.excluded)) return 'DIRECT';

  // 4. Host / parent domain proxy
  const hostRule = find(R.hosts);
  if (hostRule && hostRule.p) return hostRule.p;

  // 5. Global proxy
  if (R.global) return R.global;

  return 'DIRECT';
}

export const buildPacScript = (rules: PacRules): string =>
  [
    '// Generated by the Mullvad Browser Extension',
    `var RULES = ${JSON.stringify(rules)};`,
    `var pacFindProxy = ${pacFindProxy.toString()};`,
    'function FindProxyForURL(url, host) { return pacFindProxy(RULES, host); }',
  ].join('\n');
