// @vitest-environment node
// Builds the production service worker bundle and runs it against a mocked `chrome`, then
// evaluates the PAC script it emits. Guards against the bundler breaking the PAC runtime.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = path.resolve(__dirname, '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mullvad-sw-'));

const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });

const relays = Array.from({ length: 20 }, (_, i) => ({
  online: true,
  hostname: `relay-${i}`,
  ipv4_address: `10.124.${i}.1`,
  port: 1080,
}));

const store: Record<string, string> = {
  globalProxy: JSON.stringify({ type: 'socks', host: '10.124.0.241', port: 1080, proxyDNS: true }),
  globalProxyDetails: JSON.stringify({ socksEnabled: true }),
  hostProxies: JSON.stringify({ 'ipinfo.io': { type: 'socks', host: '10.124.1.218', port: 1080 } }),
  hostProxiesDetails: JSON.stringify({ 'ipinfo.io': { socksEnabled: true } }),
  excludedHosts: JSON.stringify(['ifconfig.co']),
  flatProxiesList: JSON.stringify(relays),
};

let pac: string | undefined;

const chromeMock = {
  runtime: { onInstalled: event(), onStartup: event() },
  storage: {
    onChanged: event(),
    local: {
      get: vi.fn(async (keys: string | string[]) =>
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]]),
        ),
      ),
      set: vi.fn(async (items: Record<string, string>) => Object.assign(store, items)),
    },
    session: { get: vi.fn(async () => ({ randomProxySeed: 'seed' })), set: vi.fn() },
  },
  permissions: { onAdded: event(), onRemoved: event(), contains: vi.fn(async () => false) },
  tabs: { onActivated: event(), onUpdated: event(), query: vi.fn(async () => []) },
  proxy: {
    onProxyError: event(),
    settings: {
      onChange: event(),
      set: vi.fn(async ({ value }) => {
        pac = value.pacScript.data;
      }),
      clear: vi.fn(),
      get: vi.fn(async () => ({
        levelOfControl: 'controlled_by_this_extension',
        value: { mode: 'pac_script', pacScript: { data: pac } },
      })),
    },
  },
  management: {
    onInstalled: event(),
    onUninstalled: event(),
    onEnabled: event(),
    onDisabled: event(),
  },
  extension: { isAllowedIncognitoAccess: vi.fn(async () => true) },
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
};

const findProxy = (url: string) => {
  const context = vm.createContext({});
  vm.runInContext(pac!, context);
  return context.FindProxyForURL(url, new URL(url).hostname);
};

beforeAll(async () => {
  await build({
    configFile: path.join(root, 'vite.config.background.mts'),
    mode: 'production',
    logLevel: 'silent',
    build: { outDir, minify: true },
  });
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  );
  await import(/* @vite-ignore */ pathToFileURL(path.join(outDir, 'background.js')).href);
  for (let i = 0; i < 50 && !pac; i++) await new Promise((r) => setTimeout(r, 20));
}, 60000);

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('built service worker bundle', () => {
  it('registers the proxy listeners at the top level', () => {
    expect(chromeMock.storage.onChanged.addListener).toHaveBeenCalled();
    expect(chromeMock.proxy.settings.onChange.addListener).toHaveBeenCalled();
  });

  it('applies a PAC script on start', () => {
    expect(pac).toBeTypeOf('string');
    expect(chromeMock.proxy.settings.set).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.objectContaining({ mode: 'pac_script' }) }),
    );
  });

  it('emits a PAC script that routes correctly', () => {
    expect(findProxy('https://am.i.mullvad.net/json')).toBe('SOCKS 10.124.0.241:1080');
    expect(findProxy('https://ipinfo.io/json')).toBe('SOCKS 10.124.1.218:1080');
    expect(findProxy('https://www.ipinfo.io/')).toBe('SOCKS 10.124.1.218:1080');
    expect(findProxy('https://ifconfig.co/')).toBe('DIRECT');
    expect(findProxy('http://192.168.1.1/')).toBe('DIRECT');
  });

  it('emits a working random mode', async () => {
    store.randomProxyMode = 'true';
    const [listener] = chromeMock.storage.onChanged.addListener.mock.calls[0];
    pac = undefined;
    listener({ randomProxyMode: { newValue: 'true' } }, 'local');
    for (let i = 0; i < 50 && !pac; i++) await new Promise((r) => setTimeout(r, 20));
    const a = findProxy('https://example.com/');
    expect(a).toMatch(/^SOCKS 10\.124\.\d+\.1:1080$/);
    expect(findProxy('https://www.example.com/x')).toBe(a);
  });
});
