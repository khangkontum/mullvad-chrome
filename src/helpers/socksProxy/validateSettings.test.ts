import { describe, expect, it } from 'vitest';

import { validateImportedSettings } from '@/helpers/socksProxy/validateSettings';

const proxy = { type: 'socks', host: '10.124.0.241', port: 1080, proxyDNS: true };
const details = { socksEnabled: true, server: 'ch-zrh', country: 'Switzerland', city: 'Zurich' };

const valid = {
  excludedHosts: ['Example.COM'],
  globalProxy: proxy,
  globalProxyDetails: details,
  hostProxies: { 'Bücher.de': proxy },
  hostProxiesDetails: { 'Bücher.de': details },
};

describe('validateImportedSettings', () => {
  it('accepts an exported file and normalizes hosts', () => {
    const result = validateImportedSettings(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.excludedHosts).toEqual(['example.com']);
    expect(Object.keys(result.value.hostProxies)).toEqual(['xn--bcher-kva.de']);
    expect(Object.keys(result.value.hostProxiesDetails)).toEqual(['xn--bcher-kva.de']);
  });

  it('accepts empty settings', () => {
    const result = validateImportedSettings({
      excludedHosts: [],
      globalProxy: {},
      globalProxyDetails: {},
      hostProxies: {},
      hostProxiesDetails: {},
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['not an object', []],
    ['missing fields', {}],
    ['excludedHosts not a list', { ...valid, excludedHosts: 'example.com' }],
    ['invalid excluded host', { ...valid, excludedHosts: ['exa mple.com'] }],
    [
      'PAC injection in proxy host',
      { ...valid, globalProxy: { ...proxy, host: '1.1.1.1:1; DIRECT' } },
    ],
    ['http proxy type', { ...valid, globalProxy: { ...proxy, type: 'http' } }],
    ['invalid port', { ...valid, hostProxies: { 'Bücher.de': { ...proxy, port: 99999 } } }],
    ['enabled global proxy without proxy', { ...valid, globalProxy: {} }],
    [
      'socksEnabled not boolean',
      { ...valid, globalProxyDetails: { ...details, socksEnabled: 'yes' } },
    ],
    ['host proxy without details', { ...valid, hostProxiesDetails: {} }],
    [
      'invalid site key',
      { ...valid, hostProxies: { 'a/b': proxy }, hostProxiesDetails: { 'a/b': details } },
    ],
    ['details with non-string city', { ...valid, globalProxyDetails: { ...details, city: 1 } }],
  ])('rejects %s', (_name, data) => {
    const result = validateImportedSettings(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });
});
