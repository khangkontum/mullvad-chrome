import { readonly, ref } from 'vue';

import {
  DEFAULT_PROXY_STATUS,
  parseProxyStatus,
  PROXY_STATUS_KEY,
  ProxyStatus,
} from '@/helpers/proxyStatus';

// Status written by the service worker; kept in sync live since it can change at any time
// (e.g. another extension taking over the proxy settings while the popup is open).
const status = ref<ProxyStatus>({ ...DEFAULT_PROXY_STATUS });

const load = async () => {
  const { [PROXY_STATUS_KEY]: stored } = await chrome.storage.local.get(PROXY_STATUS_KEY);
  status.value = parseProxyStatus(stored);
};

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'local' && PROXY_STATUS_KEY in changes) {
    status.value = parseProxyStatus(changes[PROXY_STATUS_KEY].newValue);
  }
});
void load();

// Drop all proxy rules (used to recover from corrupted settings)
const resetProxySettings = async () => {
  await chrome.storage.local.set({
    excludedHosts: JSON.stringify([]),
    flatProxiesList: JSON.stringify([]),
    globalProxy: JSON.stringify({}),
    globalProxyDetails: JSON.stringify({}),
    hostProxies: JSON.stringify({}),
    hostProxiesDetails: JSON.stringify({}),
    randomProxyMode: JSON.stringify(false),
  });
  location.reload();
};

const openExtensionSettings = () =>
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });

const useProxyStatus = () => ({
  proxyStatus: readonly(status),
  resetProxySettings,
  openExtensionSettings,
});

export default useProxyStatus;
