import { parseStored } from '@/helpers/storage';

// Written by the service worker after every attempt to apply the proxy settings.
export const PROXY_STATUS_KEY = 'proxyStatus';

export type ProxyStatus = {
  // proxy rules are configured, so the extension needs to control the browser proxy settings
  active: boolean;
  // our PAC script is the one in effect
  applied: boolean;
  // chrome.proxy.settings levelOfControl
  levelOfControl: string;
  // rules are configured but another extension/policy controls the proxy settings
  controlLost: boolean;
  // the stored settings couldn't be used: all traffic is blocked
  error: string | null;
  // problems with individual rules (they fail closed or are ignored)
  issues: string[];
  // proxy settings only apply to incognito windows with incognito access
  incognitoAllowed: boolean;
};

export const DEFAULT_PROXY_STATUS: ProxyStatus = {
  active: false,
  applied: false,
  levelOfControl: 'controllable_by_this_extension',
  controlLost: false,
  error: null,
  issues: [],
  incognitoAllowed: true,
};

export const parseProxyStatus = (value: unknown): ProxyStatus => ({
  ...DEFAULT_PROXY_STATUS,
  ...parseStored<Partial<ProxyStatus>>(value, {}),
});

export const isProxyBroken = (status: ProxyStatus) => status.controlLost || Boolean(status.error);
