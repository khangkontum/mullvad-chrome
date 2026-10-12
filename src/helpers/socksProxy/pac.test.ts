import { describe, expect, it } from 'vitest';
import vm from 'node:vm';

import {
  BLOCK_ALL_PAC,
  buildPacScript,
  compilePacRules,
  PAC_BLOCK,
  ProxyState,
  toPacProxy,
} from '@/helpers/socksProxy/pac';
import { ProxyInfoType } from '@/helpers/socksProxy/socksProxy.types';
import type { SocksProxy } from '@/helpers/socksProxy/socksProxies.types';

const socks = (host: string, port = 1080) => ({
  type: ProxyInfoType.socks,
  host,
  port,
  proxyDNS: true,
});

const details = (socksEnabled = true) => ({ socksEnabled, server: 'x', proxyDNS: true });

const relay = (ip: string): SocksProxy =>
  ({ online: true, hostname: `relay-${ip}`, ipv4_address: ip, port: 1080 }) as SocksProxy;

const baseState: ProxyState = {
  excludedHosts: [],
  globalProxy: {},
  globalProxyDetails: { socksEnabled: false },
  hostProxies: { 'protected.example': socks('10.64.0.1') },
  hostProxiesDetails: { 'protected.example': details() },
  randomProxyMode: false,
  flatProxiesList: [],
  randomSeed: 'seed',
};

// Evaluate the generated PAC script like Chrome would, and query it
const evalPac = (script: string, url: string) => {
  const context = vm.createContext({});
  vm.runInContext(script, context);
  return context.FindProxyForURL(url, new URL(url).hostname) as string;
};
const runPac = (state: ProxyState, url: string) =>
  evalPac(buildPacScript(compilePacRules(state).rules), url);

describe('PAC: local DNS resolution', () => {
  // SOCKS5 would leave DNS to the Mullvad relay, whose resolvers intermittently fail for some
  // domains; SOCKS (SOCKS4) makes Chrome resolve locally and send the IP to the relay.
  it('emits SOCKS (not SOCKS5) for socks and socks4 proxies, regardless of proxyDNS', () => {
    expect(toPacProxy(socks('10.124.0.1'))).toBe('SOCKS 10.124.0.1:1080');
    expect(toPacProxy({ ...socks('10.124.0.1'), proxyDNS: false })).toBe('SOCKS 10.124.0.1:1080');
    expect(toPacProxy({ ...socks('10.124.0.1'), type: ProxyInfoType.socks4 })).toBe(
      'SOCKS 10.124.0.1:1080',
    );
  });

  it('keeps the block result SOCKS5, so blocked sites never trigger a local lookup', () => {
    expect(PAC_BLOCK).toMatch(/^SOCKS5 /);
  });

  it('still routes IPv6-literal URLs to the proxy (unreachable via SOCKS4, never direct)', () => {
    const state: ProxyState = {
      ...baseState,
      globalProxy: socks('10.124.0.1'),
      globalProxyDetails: { socksEnabled: true },
    };
    expect(runPac(state, 'http://[2001:db8::1]/')).toBe('SOCKS 10.124.0.1:1080');
  });
});

describe('PAC: per-domain rules apply to the requested host', () => {
  it('proxies a request to a host with a proxy rule (e.g. a third-party subresource)', () => {
    expect(runPac(baseState, 'https://protected.example/tracker-pixel')).toBe(
      'SOCKS 10.64.0.1:1080',
    );
  });

  it('applies the parent-domain rule to subdomains', () => {
    expect(runPac(baseState, 'https://login.protected.example/static.js')).toBe(
      'SOCKS 10.64.0.1:1080',
    );
  });

  it('does not leak the proxy to an unrelated host embedded in a proxied page', () => {
    expect(runPac(baseState, 'https://unrelated.example/asset.png')).toBe('DIRECT');
  });

  it('uses the global proxy for hosts without their own rule', () => {
    const state = {
      ...baseState,
      globalProxy: socks('10.124.0.1'),
      globalProxyDetails: details(),
    };
    expect(runPac(state, 'https://cdn.unrelated.example/a.js')).toBe('SOCKS 10.124.0.1:1080');
    expect(runPac(state, 'https://protected.example/')).toBe('SOCKS 10.64.0.1:1080');
  });

  it('prefers the exact subdomain rule over the parent domain rule', () => {
    const state = {
      ...baseState,
      hostProxies: { ...baseState.hostProxies, 'www.protected.example': socks('10.8.0.1') },
      hostProxiesDetails: { ...baseState.hostProxiesDetails, 'www.protected.example': details() },
    };
    expect(runPac(state, 'https://www.protected.example/')).toBe('SOCKS 10.8.0.1:1080');
    expect(runPac(state, 'https://api.protected.example/')).toBe('SOCKS 10.64.0.1:1080');
  });

  it('a subdomain rule does not apply to the parent or sibling domains', () => {
    const state = {
      ...baseState,
      hostProxies: { 'www.other.example': socks('10.8.0.1') },
      hostProxiesDetails: { 'www.other.example': details() },
    };
    expect(runPac(state, 'https://other.example/')).toBe('DIRECT');
    expect(runPac(state, 'https://a.www.other.example/')).toBe('DIRECT');
  });

  it('ignores disabled host rules', () => {
    const state = { ...baseState, hostProxiesDetails: { 'protected.example': details(false) } };
    expect(runPac(state, 'https://protected.example/')).toBe('DIRECT');
  });

  it('does not match hosts that merely end with the configured domain', () => {
    expect(runPac(baseState, 'https://notprotected.example/')).toBe('DIRECT');
  });
});

describe('PAC: exclusions', () => {
  const state = {
    ...baseState,
    globalProxy: socks('10.124.0.1'),
    globalProxyDetails: details(),
    excludedHosts: ['protected.example', 'direct.test.example'],
  };

  it('excluded hosts (and their subdomains) go direct, even with host/global rules', () => {
    expect(runPac(state, 'https://protected.example/')).toBe('DIRECT');
    expect(runPac(state, 'https://www.protected.example/')).toBe('DIRECT');
  });

  it('an excluded subdomain does not exclude its parent', () => {
    expect(runPac(state, 'https://direct.test.example/')).toBe('DIRECT');
    expect(runPac(state, 'https://test.example/')).toBe('SOCKS 10.124.0.1:1080');
  });
});

describe('PAC: local and reserved addresses', () => {
  const state = { ...baseState, globalProxy: socks('10.124.0.1'), globalProxyDetails: details() };
  it.each([
    'http://localhost:8080/',
    'http://127.0.0.1/',
    'http://192.168.1.1/',
    'http://10.0.0.1/',
    'http://172.20.0.1/',
    'http://169.254.1.1/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
  ])('%s goes direct', (url) => {
    expect(runPac(state, url)).toBe('DIRECT');
  });

  it('public IPs follow the global proxy', () => {
    expect(runPac(state, 'http://8.8.8.8/')).toBe('SOCKS 10.124.0.1:1080');
    expect(runPac(state, 'http://172.32.0.1/')).toBe('SOCKS 10.124.0.1:1080');
  });
});

describe('PAC: random mode', () => {
  const relays = Array.from({ length: 50 }, (_, i) => relay(`10.124.${i}.1`));
  const state = { ...baseState, randomProxyMode: true, flatProxiesList: relays };

  it('is stable per site, including subdomains', () => {
    const a = runPac(state, 'https://example.com/');
    expect(a).toMatch(/^SOCKS 10\.124\.\d+\.1:1080$/);
    expect(runPac(state, 'https://www.example.com/x')).toBe(a);
    expect(runPac(state, 'https://cdn.static.example.com/x')).toBe(a);
  });

  it('treats common two-level public suffixes as part of the site', () => {
    expect(runPac(state, 'https://www.bbc.co.uk/')).toBe(runPac(state, 'https://bbc.co.uk/'));
  });

  it('spreads different sites across relays and depends on the session seed', () => {
    const sites = Array.from({ length: 20 }, (_, i) => `https://site${i}.com/`);
    const picks = new Set(sites.map((url) => runPac(state, url)));
    expect(picks.size).toBeGreaterThan(5);

    const reseeded = sites.map((url) => runPac({ ...state, randomSeed: 'other' }, url));
    expect(reseeded).not.toEqual(sites.map((url) => runPac(state, url)));
  });

  it('overrides host rules and exclusions', () => {
    const s = { ...state, excludedHosts: ['example.com'] };
    expect(runPac(s, 'https://example.com/')).not.toBe('DIRECT');
  });

  it('fails closed when no relay list is available, except for the relay list API', () => {
    const empty = { ...state, flatProxiesList: [] };
    expect(compilePacRules(empty).issues).toHaveLength(1);
    expect(runPac(empty, 'https://example.com/')).toBe(PAC_BLOCK);
    expect(runPac(empty, 'https://api.mullvad.net/network/v1-beta1/socks-proxies')).toBe('DIRECT');
    expect(runPac(empty, 'https://am.i.mullvad.net/json')).toBe(PAC_BLOCK);
  });

  describe('stability (rendezvous hashing)', () => {
    const sites = Array.from({ length: 200 }, (_, i) => `https://www.site${i}.com/`);
    const picks = (s: ProxyState) => sites.map((url) => runPac(s, url));
    const before = picks(state);

    it('spreads sites over relays', () => {
      expect(new Set(before).size).toBeGreaterThan(40);
    });

    it('does not depend on the order of the relay list', () => {
      expect(picks({ ...state, flatProxiesList: [...relays].reverse() })).toEqual(before);
    });

    it('only moves sites whose relay disappeared', () => {
      const removed = relays.find((r) => before[0] === `SOCKS ${r.ipv4_address}:1080`)!;
      const after = picks({ ...state, flatProxiesList: relays.filter((r) => r !== removed) });
      const removedPac = `SOCKS ${removed.ipv4_address}:1080`;
      sites.forEach((_, i) => {
        if (before[i] === removedPac) expect(after[i]).not.toBe(removedPac);
        else expect(after[i]).toBe(before[i]);
      });
      expect(before).toContain(removedPac);
    });

    it('moves only the sites won by a newly added relay', () => {
      const added = relay('10.124.200.1');
      const after = picks({ ...state, flatProxiesList: [...relays, added] });
      const moved = sites.filter((_, i) => after[i] !== before[i]);
      moved.forEach((url) =>
        expect(runPac({ ...state, flatProxiesList: [...relays, added] }, url)).toBe(
          'SOCKS 10.124.200.1:1080',
        ),
      );
      // ~1/51 of the sites are expected to move
      expect(moved.length).toBeLessThan(20);
    });
  });
});

describe('PAC: compiled rules', () => {
  it('normalizes hosts', () => {
    const { rules } = compilePacRules({
      ...baseState,
      excludedHosts: ['PROTECTED.example.'],
    });
    expect(rules.excluded).toEqual([{ h: 'protected.example', s: true }]);
  });

  it('is inactive when nothing is configured', () => {
    const compiled = compilePacRules({ ...baseState, hostProxies: {}, hostProxiesDetails: {} });
    expect(compiled.active).toBe(false);
    expect(compiled.rules.global).toBeNull();
    expect(
      runPac({ ...baseState, hostProxies: {}, hostProxiesDetails: {} }, 'https://a.com/'),
    ).toBe('DIRECT');
  });

  it('BLOCK_ALL_PAC blocks everything', () => {
    expect(evalPac(BLOCK_ALL_PAC, 'https://example.com/')).toBe(PAC_BLOCK);
    expect(evalPac(BLOCK_ALL_PAC, 'https://api.mullvad.net/')).toBe(PAC_BLOCK);
  });
});

describe('PAC: invalid proxies fail closed', () => {
  const withHostProxy = (proxy: unknown): ProxyState => ({
    ...baseState,
    hostProxies: { 'protected.example': proxy as ReturnType<typeof socks> },
  });

  it.each([
    ['host injecting a PAC fallback', { ...socks('10.64.0.1'), host: '10.64.0.1:1080; DIRECT' }],
    ['host with semicolon', { ...socks('x'), host: 'a;DIRECT' }],
    ['non-socks type', { ...socks('10.64.0.1'), type: 'http' }],
    ['direct type', { ...socks('10.64.0.1'), type: 'direct' }],
    ['port 0', socks('10.64.0.1', 0)],
    ['port out of range', socks('10.64.0.1', 70000)],
    ['port as string', { ...socks('10.64.0.1'), port: '1080' }],
    ['missing proxy', undefined],
  ])('%s → blocked, not direct', (_name, proxy) => {
    const state = withHostProxy(proxy);
    const compiled = compilePacRules(state);
    expect(compiled.active).toBe(true);
    expect(compiled.issues.length).toBeGreaterThan(0);
    expect(runPac(state, 'https://protected.example/')).toBe(PAC_BLOCK);
    expect(runPac(state, 'https://www.protected.example/')).toBe(PAC_BLOCK);
    // other hosts are unaffected
    expect(runPac(state, 'https://other.example/')).toBe('DIRECT');
  });

  it('enabled global proxy without a valid proxy blocks instead of going direct', () => {
    const state: ProxyState = {
      ...baseState,
      hostProxies: {},
      hostProxiesDetails: {},
      globalProxy: {},
      globalProxyDetails: { socksEnabled: true },
    };
    const compiled = compilePacRules(state);
    expect(compiled.active).toBe(true);
    expect(runPac(state, 'https://example.com/')).toBe(PAC_BLOCK);
  });

  it('formats IPv6 proxies with brackets and accepts SOCKS4', () => {
    const state: ProxyState = {
      ...baseState,
      hostProxies: {
        'protected.example': { ...socks('2001:DB8::1'), type: ProxyInfoType.socks4 },
      },
    };
    expect(runPac(state, 'https://protected.example/')).toBe('SOCKS [2001:db8::1]:1080');
  });

  it('ignores invalid sites and excluded hosts, and reports them', () => {
    const state: ProxyState = {
      ...baseState,
      excludedHosts: ['bad host', 42 as unknown as string],
      hostProxies: { 'bad/host': socks('10.64.0.1') },
      hostProxiesDetails: { 'bad/host': details() },
    };
    const compiled = compilePacRules(state);
    expect(compiled.rules.excluded).toEqual([]);
    expect(compiled.rules.hosts).toEqual([]);
    expect(compiled.issues).toHaveLength(3);
  });
});

describe('PAC: host normalization', () => {
  it('matches IDN and uppercase rules against the punycode host Chrome passes to the PAC', () => {
    const state: ProxyState = {
      ...baseState,
      hostProxies: {
        'Bücher.Example': socks('10.8.0.1'),
        ' WWW.Other.Example ': socks('10.9.0.1'),
      },
      hostProxiesDetails: { 'Bücher.Example': details(), ' WWW.Other.Example ': details() },
    };
    expect(runPac(state, 'https://xn--bcher-kva.example/')).toBe('SOCKS 10.8.0.1:1080');
    expect(runPac(state, 'https://shop.bücher.example/')).toBe('SOCKS 10.8.0.1:1080');
    expect(runPac(state, 'https://www.other.example/')).toBe('SOCKS 10.9.0.1:1080');
  });
});
