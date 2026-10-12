import { describe, expect, it } from 'vitest';
import vm from 'node:vm';

import {
  buildPacScript,
  compilePacRules,
  pacFindProxy,
  PAC_BLOCK,
  ProxyState,
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
  ({ online: true, hostname: ip, ipv4_address: ip, port: 1080 }) as SocksProxy;

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
const runPac = (state: ProxyState, url: string) => {
  const context = vm.createContext({});
  vm.runInContext(buildPacScript(compilePacRules(state)), context);
  return context.FindProxyForURL(url, new URL(url).hostname) as string;
};

describe('PAC: per-domain rules apply to the requested host', () => {
  it('proxies a request to a host with a proxy rule (e.g. a third-party subresource)', () => {
    expect(runPac(baseState, 'https://protected.example/tracker-pixel')).toBe(
      'SOCKS5 10.64.0.1:1080',
    );
  });

  it('applies the parent-domain rule to subdomains', () => {
    expect(runPac(baseState, 'https://login.protected.example/static.js')).toBe(
      'SOCKS5 10.64.0.1:1080',
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
    expect(runPac(state, 'https://cdn.unrelated.example/a.js')).toBe('SOCKS5 10.124.0.1:1080');
    expect(runPac(state, 'https://protected.example/')).toBe('SOCKS5 10.64.0.1:1080');
  });

  it('prefers the exact subdomain rule over the parent domain rule', () => {
    const state = {
      ...baseState,
      hostProxies: { ...baseState.hostProxies, 'www.protected.example': socks('10.8.0.1') },
      hostProxiesDetails: { ...baseState.hostProxiesDetails, 'www.protected.example': details() },
    };
    expect(runPac(state, 'https://www.protected.example/')).toBe('SOCKS5 10.8.0.1:1080');
    expect(runPac(state, 'https://api.protected.example/')).toBe('SOCKS5 10.64.0.1:1080');
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
    expect(runPac(state, 'https://test.example/')).toBe('SOCKS5 10.124.0.1:1080');
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
    expect(runPac(state, 'http://8.8.8.8/')).toBe('SOCKS5 10.124.0.1:1080');
    expect(runPac(state, 'http://172.32.0.1/')).toBe('SOCKS5 10.124.0.1:1080');
  });
});

describe('PAC: random mode', () => {
  const relays = Array.from({ length: 50 }, (_, i) => relay(`10.124.${i}.1`));
  const state = { ...baseState, randomProxyMode: true, flatProxiesList: relays };

  it('is stable per site, including subdomains', () => {
    const a = runPac(state, 'https://example.com/');
    expect(a).toMatch(/^SOCKS5 10\.124\.\d+\.1:1080$/);
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

  it('fails closed when no relay list is available', () => {
    expect(runPac({ ...state, flatProxiesList: [] }, 'https://example.com/')).toBe(PAC_BLOCK);
  });
});

describe('pacFindProxy', () => {
  it('matches the generated PAC script', () => {
    const rules = compilePacRules({
      ...baseState,
      excludedHosts: ['protected.example'],
    });
    expect(pacFindProxy(rules, 'protected.example')).toBe('DIRECT');
    expect(pacFindProxy(rules, 'PROTECTED.example.')).toBe('DIRECT');
  });

  it('defaults to DIRECT when nothing is configured', () => {
    const rules = compilePacRules({ ...baseState, hostProxies: {}, hostProxiesDetails: {} });
    expect(rules.global).toBeNull();
    expect(pacFindProxy(rules, 'example.com')).toBe('DIRECT');
  });
});
