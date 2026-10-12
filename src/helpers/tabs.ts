import { checkDomain } from '@/helpers/domain';
import { ProxyDetails, ProxyDetailsMap } from '@/helpers/socksProxy/socksProxy.types';
import { parseStored } from '@/helpers/storage';

export const reloadMatchingTabs = async (url: string) => {
  const urlPattern = `*://*.${url}/*`;

  const tabs = await chrome.tabs.query({ url: urlPattern });
  tabs.forEach((tab) => {
    if (tab.id) {
      chrome.tabs.reload(tab.id);
    }
  });
};

export const reloadGlobalProxiedTabs = async (excludedURLs: string[]) => {
  const tabs = await chrome.tabs.query({ url: '*://*/*' });

  const tabsToReload = tabs.filter((tab) => {
    if (!tab.url) {
      return false;
    }
    return !isExcludedURL(tab.url, excludedURLs);
  });

  tabsToReload.forEach((tab) => {
    if (tab.id) {
      chrome.tabs.reload(tab.id);
    }
  });
};

const isExcludedURL = (url: string, excludedURLs: string[]): boolean => {
  const { hostname } = new URL(url);
  return excludedURLs.some((excludedUrl) => hostname === excludedUrl);
};

export const getActiveTabDetails = async () => {
  const activeTab = await getActiveTab();

  // activeTab will be null if tabs permission has not been granted
  if (!activeTab?.url) {
    return { host: '', protocol: '', isAboutPage: false, isExtensionPage: false };
  }

  const activeTabURL = new URL(activeTab.url);

  return {
    host: activeTabURL.hostname,
    protocol: activeTabURL.protocol,
    // Browser internal pages (chrome://, about:, edge://…), which are never proxied
    isAboutPage: ['about:', 'chrome:', 'edge:', 'brave:', 'devtools:'].includes(
      activeTabURL.protocol,
    ),
    isExtensionPage: activeTabURL.protocol === 'chrome-extension:',
  };
};

export const getActiveProxyDetails = async () => {
  const globalProxyDetails = await getGlobalProxyDetails();
  const { hostProxiesDetails } = await chrome.storage.local.get('hostProxiesDetails');
  const activeTab = await getActiveTab();

  if (hostProxiesDetails && activeTab?.url) {
    const hostProxiesDetailsParsed: ProxyDetailsMap = parseStored(hostProxiesDetails, {});
    const tabHost = new URL(activeTab.url).hostname;
    const { domain } = checkDomain(tabHost);

    // Check subdomain proxy first
    if (hostProxiesDetailsParsed[tabHost]?.socksEnabled) {
      return hostProxiesDetailsParsed[tabHost];
    }

    // Then check domain proxy
    if (hostProxiesDetailsParsed[domain]?.socksEnabled) {
      return hostProxiesDetailsParsed[domain];
    }
  }

  return globalProxyDetails;
};

const getGlobalProxyDetails = async (): Promise<ProxyDetails> => {
  const response = await chrome.storage.local.get('globalProxyDetails');

  return parseStored(response.globalProxyDetails, { socksEnabled: false });
};

export const getActiveTab = async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
};
