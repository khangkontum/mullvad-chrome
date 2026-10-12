import { checkDomain } from '@/helpers/domain';
import { isLocalOrReservedIP } from '@/helpers/socksProxy/socksProxy';
import { ProxyDetails, ProxyDetailsMap } from '@/helpers/socksProxy/socksProxy.types';
import { parseStored } from '@/helpers/storage';
import { isProxyBroken, parseProxyStatus, PROXY_STATUS_KEY } from '@/helpers/proxyStatus';
import { getActiveProxyDetails, getActiveTab } from '@/helpers/tabs';

export const updateCurrentTabProxyBadge = async () => {
  const activeTab = await getActiveTab();

  if (activeTab) {
    await updateTabProxyBadge(activeTab, await getActiveProxyDetails());
  }
};

export const updateTabProxyBadge = async (
  tab: chrome.tabs.Tab,
  activeProxyDetails: ProxyDetails,
) => {
  const { id: tabId, url } = tab;
  const { excludedHosts, hostProxiesDetails, globalProxyDetails, randomProxyMode } =
    await chrome.storage.local.get([
      'excludedHosts',
      'hostProxiesDetails',
      'globalProxyDetails',
      'randomProxyMode',
    ]);

  const hostProxiesDetailsParsed: ProxyDetailsMap = parseStored(hostProxiesDetails, {});
  const excludedHostsParsed: string[] = parseStored(excludedHosts, []);
  const globalProxyDetailsParsed: Partial<ProxyDetails> = parseStored(globalProxyDetails, {});
  const randomProxyModeParsed: boolean = parseStored(randomProxyMode, false);

  const { [PROXY_STATUS_KEY]: storedStatus } = await chrome.storage.local.get(PROXY_STATUS_KEY);
  const status = parseProxyStatus(storedStatus);
  if (isProxyBroken(status)) {
    const title =
      status.error ??
      status.readError ??
      status.applyError ??
      'Mullvad proxy settings are not in effect (controlled elsewhere)';
    chrome.action.setTitle({ tabId, title });
    await chrome.action.setBadgeText({ text: '!', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#e34039', tabId });
    await chrome.action.setBadgeTextColor({ color: 'white', tabId });
    return;
  }

  if (!url || !/^(https?|wss?):$/.test(new URL(url).protocol)) {
    await setTabExtBadge(tab, false, false);
    return;
  }

  const tabHost = new URL(url).hostname;
  const { domain, fullHost, hasSubdomain } = checkDomain(tabHost);

  // Block for local/reserved IPs
  if (isLocalOrReservedIP(tabHost)) {
    chrome.action.setTitle({ tabId, title: 'Local/Reserved IP - No proxy needed' });
    await setTabExtBadge(tab, false, false);
    return;
  }

  // 0. Check for random proxy mode
  if (randomProxyModeParsed) {
    // If it's random proxy mode, we show a shuffle icon on the badge
    const title = `Random proxy`;
    chrome.action.setTitle({ tabId, title });
    await setTabExtBadge(tab, true, false, '🔀', true);
    return;
  }

  // 1. Check subdomain level
  if (hasSubdomain) {
    if (excludedHostsParsed.includes(fullHost)) {
      chrome.action.setTitle({ tabId, title: `${fullHost} is set to never be proxied` });
      await setTabExtBadge(tab, false, true);
      return;
    }

    if (hostProxiesDetailsParsed[fullHost]?.socksEnabled) {
      const title = `${activeProxyDetails.city}, ${activeProxyDetails.country}\nServer: ${activeProxyDetails.server}`;
      chrome.action.setTitle({ tabId, title });
      await setTabExtBadge(tab, true, false, activeProxyDetails.countryCode);
      return;
    }
  }

  // 2. Check domain level
  if (excludedHostsParsed.includes(domain)) {
    chrome.action.setTitle({ tabId, title: `${domain} is set to never be proxied` });
    await setTabExtBadge(tab, false, true);
    return;
  }

  if (hostProxiesDetailsParsed[domain]?.socksEnabled) {
    const title = `${activeProxyDetails.city}, ${activeProxyDetails.country}\nServer: ${activeProxyDetails.server}`;
    chrome.action.setTitle({ tabId, title });
    await setTabExtBadge(tab, true, false, activeProxyDetails.countryCode);
    return;
  }

  // 3. Check global proxy
  if (globalProxyDetailsParsed.socksEnabled) {
    const title = `${activeProxyDetails.city}, ${activeProxyDetails.country}\nServer: ${activeProxyDetails.server}`;
    chrome.action.setTitle({ tabId, title });
    await setTabExtBadge(tab, true, false, activeProxyDetails.countryCode);
    return;
  }

  // 4. Default: no proxy
  chrome.action.setTitle({ tabId, title: 'Proxy not in use' });
  await setTabExtBadge(tab, false, false);
};

const setTabExtBadge = async (
  tab: chrome.tabs.Tab,
  proxy = true,
  isExcluded = false,
  countryCode = 'P',
  randomProxyMode = false,
) => {
  const { id: tabId } = tab;

  if (isExcluded) {
    chrome.action.setBadgeText({ text: '🚫', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#ffd524', tabId });
    chrome.action.setBadgeTextColor({ color: 'black', tabId });
  } else if (proxy) {
    chrome.action.setBadgeText({ text: countryCode.toUpperCase(), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#ffd524', tabId });
    chrome.action.setBadgeTextColor({ color: 'black', tabId });
  } else if (randomProxyMode) {
    chrome.action.setBadgeText({ text: countryCode, tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
};

export const clearAllBadges = async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      await chrome.action.setBadgeText({ text: '', tabId: tab.id });
    }
  }
};
