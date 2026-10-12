import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onProxySettingsChanged, updateProxySettings } from '@/background/proxy';
import { BLOCK_ALL_PAC } from '@/helpers/socksProxy/pac';
import { parseProxyStatus } from '@/helpers/proxyStatus';

type Setting = { levelOfControl: string; value: chrome.proxy.ProxyConfig };

let store: Record<string, unknown>;
let setting: Setting;
let otherExtensionInControl: boolean;
let setError: Error | null;

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) =>
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]]),
        ),
      ),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
    },
    session: {
      get: vi.fn(async () => ({ randomProxySeed: 'seed' })),
      set: vi.fn(),
    },
  },
  proxy: {
    settings: {
      set: vi.fn(async ({ value }: { value: chrome.proxy.ProxyConfig }) => {
        if (setError) throw setError;
        if (!otherExtensionInControl)
          setting = { levelOfControl: 'controlled_by_this_extension', value };
      }),
      clear: vi.fn(async () => {
        if (!otherExtensionInControl)
          setting = { levelOfControl: 'controllable_by_this_extension', value: { mode: 'system' } };
      }),
      get: vi.fn(async () => setting),
    },
  },
  extension: { isAllowedIncognitoAccess: vi.fn(async () => false) },
  action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
};
vi.stubGlobal('chrome', chromeMock);

const status = () => parseProxyStatus(store.proxyStatus);
const lastPac = () => chromeMock.proxy.settings.set.mock.lastCall![0].value.pacScript!;

const globalCH = {
  globalProxy: JSON.stringify({ type: 'socks', host: '10.124.0.241', port: 1080 }),
  globalProxyDetails: JSON.stringify({ socksEnabled: true, server: 'ch-zrh' }),
};

beforeEach(() => {
  vi.clearAllMocks();
  store = {};
  setting = { levelOfControl: 'controllable_by_this_extension', value: { mode: 'system' } };
  otherExtensionInControl = false;
  setError = null;
});

describe('updateProxySettings', () => {
  it('applies a mandatory PAC script and verifies it is in control', async () => {
    Object.assign(store, globalCH);
    await updateProxySettings();
    expect(lastPac()).toMatchObject({ mandatory: true });
    expect(lastPac().data).toContain('SOCKS5 10.124.0.241:1080');
    expect(status()).toMatchObject({
      active: true,
      applied: true,
      controlLost: false,
      error: null,
    });
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('applies rules without the optional tabs/<all_urls> permissions', async () => {
    // no chrome.permissions mock at all: the proxy must not depend on it
    Object.assign(store, globalCH);
    await updateProxySettings();
    expect(status().applied).toBe(true);
  });

  it('releases the proxy setting when nothing is configured', async () => {
    await updateProxySettings();
    expect(chromeMock.proxy.settings.clear).toHaveBeenCalled();
    expect(chromeMock.proxy.settings.set).not.toHaveBeenCalled();
    expect(status()).toMatchObject({ active: false, controlLost: false });
  });

  it('detects another extension controlling the proxy settings', async () => {
    otherExtensionInControl = true;
    setting = { levelOfControl: 'controlled_by_other_extensions', value: { mode: 'direct' } };
    Object.assign(store, globalCH);
    await updateProxySettings();
    expect(status()).toMatchObject({ active: true, applied: false, controlLost: true });
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
  });

  it('does not swallow errors from proxy.settings.set', async () => {
    setError = new Error('not_controllable');
    Object.assign(store, globalCH);
    await updateProxySettings();
    expect(status().controlLost).toBe(true);
    expect(status().error).toContain('not_controllable');
  });

  it('detects a stale PAC script (in control, but not our current rules)', async () => {
    Object.assign(store, globalCH);
    await updateProxySettings();
    setting = { ...setting, value: { mode: 'pac_script', pacScript: { data: 'stale' } } };
    await onProxySettingsChanged({ levelOfControl: 'controlled_by_this_extension' });
    expect(status()).toMatchObject({ applied: false, controlLost: true });
  });

  it.each([
    ['invalid JSON', { globalProxyDetails: '{"socksEnabled": tr' }],
    ['wrong shape', { excludedHosts: JSON.stringify('example.com') }],
    ['wrong type', { randomProxyMode: JSON.stringify('yes') }],
    ['non-object host proxy', { hostProxies: JSON.stringify({ 'a.com': 'SOCKS5 1.1.1.1:1' }) }],
  ])('blocks all traffic when the stored settings are corrupted (%s)', async (_name, bad) => {
    Object.assign(store, globalCH, bad);
    await updateProxySettings();
    expect(lastPac().data).toBe(BLOCK_ALL_PAC);
    expect(status().error).toMatch(/corrupted/);
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' });
  });

  it('reports invalid rules, which fail closed', async () => {
    store.hostProxies = JSON.stringify({ 'a.com': { type: 'http', host: '1.1.1.1', port: 80 } });
    store.hostProxiesDetails = JSON.stringify({ 'a.com': { socksEnabled: true } });
    await updateProxySettings();
    expect(status()).toMatchObject({ active: true, applied: true });
    expect(status().issues).toEqual(['Invalid proxy for a.com: its traffic is blocked']);
  });

  it('reports missing incognito access', async () => {
    Object.assign(store, globalCH);
    await updateProxySettings();
    expect(status().incognitoAllowed).toBe(false);
    chromeMock.extension.isAllowedIncognitoAccess.mockResolvedValueOnce(true);
    await updateProxySettings();
    expect(status().incognitoAllowed).toBe(true);
  });
});

describe('onProxySettingsChanged', () => {
  it('re-applies when another extension releases control', async () => {
    Object.assign(store, globalCH);
    otherExtensionInControl = true;
    setting = { levelOfControl: 'controlled_by_other_extensions', value: { mode: 'direct' } };
    await updateProxySettings();
    expect(status().controlLost).toBe(true);

    // the other extension is disabled
    otherExtensionInControl = false;
    setting = { levelOfControl: 'controllable_by_this_extension', value: { mode: 'system' } };
    chromeMock.proxy.settings.set.mockClear();
    await onProxySettingsChanged({ levelOfControl: 'controllable_by_this_extension' });
    expect(chromeMock.proxy.settings.set).toHaveBeenCalledTimes(1);
    expect(status()).toMatchObject({ applied: true, controlLost: false });
  });

  it('does not re-apply (no loop) after its own change', async () => {
    Object.assign(store, globalCH);
    await updateProxySettings();
    chromeMock.proxy.settings.set.mockClear();
    await onProxySettingsChanged({ levelOfControl: 'controlled_by_this_extension' });
    expect(chromeMock.proxy.settings.set).not.toHaveBeenCalled();
    expect(status().applied).toBe(true);
  });

  it('marks control as lost when another extension takes over', async () => {
    Object.assign(store, globalCH);
    await updateProxySettings();
    setting = { levelOfControl: 'controlled_by_other_extensions', value: { mode: 'direct' } };
    await onProxySettingsChanged({ levelOfControl: 'controlled_by_other_extensions' });
    expect(status()).toMatchObject({ applied: false, controlLost: true });
  });
});
