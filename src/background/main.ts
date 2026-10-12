// MV3 service worker. Must not import Vue or touch the DOM, and all listeners are registered
// synchronously at the top level so Chrome can wake the worker up for them.
import { initConfig } from '@/helpers/config';
import { getProxyPermissions } from '@/helpers/permissions';
import {
  clearAllBadges,
  updateCurrentTabProxyBadge,
  updateTabProxyBadge,
} from '@/helpers/proxyBadge';
import { getActiveProxyDetails } from '@/helpers/tabs';

import { PROXY_STORAGE_KEYS, updateProxySettings } from './proxy';
import {
  onExtensionDisabled,
  onExtensionEnabled,
  onExtensionInstalled,
  onExtensionUninstalled,
} from './recommendations';

const refreshBadge = async () => {
  if (await getProxyPermissions()) {
    await updateCurrentTabProxyBadge();
  }
};

chrome.runtime.onInstalled.addListener(() => {
  void initConfig();
});

chrome.runtime.onStartup.addListener(() => {
  void initConfig();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (PROXY_STORAGE_KEYS.some((key) => key in changes)) {
    void updateProxySettings().then(refreshBadge);
  }
});

chrome.permissions.onAdded.addListener(() => {
  void updateProxySettings().then(refreshBadge);
});

chrome.permissions.onRemoved.addListener(async () => {
  await updateProxySettings();
  if (!(await getProxyPermissions())) {
    await clearAllBadges();
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!(await getProxyPermissions())) return;
  const tab = await chrome.tabs.get(tabId);
  await updateTabProxyBadge(tab, await getActiveProxyDetails());
});

chrome.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
  if (!tab.active || !(await getProxyPermissions())) return;
  await updateTabProxyBadge(tab, await getActiveProxyDetails());
});

chrome.proxy.onProxyError.addListener((details) => {
  console.warn('Proxy error', details);
});

chrome.management.onInstalled.addListener(onExtensionInstalled);
chrome.management.onUninstalled.addListener(onExtensionUninstalled);
chrome.management.onEnabled.addListener(onExtensionEnabled);
chrome.management.onDisabled.addListener(onExtensionDisabled);

// Re-apply on every worker start (cheap, and keeps the PAC in sync with storage)
void updateProxySettings().then(refreshBadge);
