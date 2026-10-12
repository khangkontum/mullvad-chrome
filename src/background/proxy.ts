import { getProxyPermissions } from '@/helpers/permissions';
import { parseStored } from '@/helpers/storage';
import { buildPacScript, compilePacRules, ProxyState } from '@/helpers/socksProxy/pac';

// Storage keys (chrome.storage.local, JSON encoded) that affect proxy routing
export const PROXY_STORAGE_KEYS = [
  'excludedHosts',
  'flatProxiesList',
  'globalProxy',
  'globalProxyDetails',
  'hostProxies',
  'hostProxiesDetails',
  'randomProxyMode',
] as const;

// The random proxy pick is stable per site for the browser session (storage.session survives
// service worker restarts but not browser restarts), like the in-memory map used on Firefox.
const getRandomSeed = async (): Promise<string> => {
  const { randomProxySeed } = await chrome.storage.session.get('randomProxySeed');
  if (typeof randomProxySeed === 'string') return randomProxySeed;
  const seed = crypto.randomUUID();
  await chrome.storage.session.set({ randomProxySeed: seed });
  return seed;
};

export const getProxyState = async (): Promise<ProxyState> => {
  const data = await chrome.storage.local.get([...PROXY_STORAGE_KEYS]);
  return {
    excludedHosts: parseStored(data.excludedHosts, []),
    flatProxiesList: parseStored(data.flatProxiesList, []),
    globalProxy: parseStored(data.globalProxy, {}),
    globalProxyDetails: parseStored(data.globalProxyDetails, {}),
    hostProxies: parseStored(data.hostProxies, {}),
    hostProxiesDetails: parseStored(data.hostProxiesDetails, {}),
    randomProxyMode: parseStored(data.randomProxyMode, false),
    randomSeed: await getRandomSeed(),
  };
};

const applyProxySettings = async () => {
  const rules = compilePacRules(await getProxyState());
  const hasRules = rules.random || rules.global || rules.hosts.length > 0;

  if (!(await getProxyPermissions()) || !hasRules) {
    // Don't take control of the browser proxy settings when nothing is configured
    await chrome.proxy.settings.clear({ scope: 'regular' });
    return;
  }

  await chrome.proxy.settings.set({
    scope: 'regular',
    value: {
      mode: 'pac_script',
      // mandatory: never silently fall back to a direct connection if the PAC script fails
      pacScript: { data: buildPacScript(rules), mandatory: true },
    },
  });
};

let queue: Promise<void> = Promise.resolve();

// Serialise updates so the last storage state always wins
export const updateProxySettings = () => {
  queue = queue.then(applyProxySettings).catch((error) => {
    console.error('Failed to apply proxy settings', error);
  });
  return queue;
};
