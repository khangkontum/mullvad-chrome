import { PROXY_STATUS_KEY, ProxyStatus } from '@/helpers/proxyStatus';
import {
  BLOCK_ALL_PAC,
  buildPacScript,
  compilePacRules,
  CompiledPac,
  ProxyState,
} from '@/helpers/socksProxy/pac';

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

type StorageKey = (typeof PROXY_STORAGE_KEYS)[number];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const SHAPES: Record<StorageKey, (v: unknown) => boolean> = {
  excludedHosts: Array.isArray,
  flatProxiesList: Array.isArray,
  globalProxy: isPlainObject,
  globalProxyDetails: isPlainObject,
  hostProxies: (v) => isPlainObject(v) && Object.values(v).every(isPlainObject),
  hostProxiesDetails: (v) => isPlainObject(v) && Object.values(v).every(isPlainObject),
  randomProxyMode: (v) => typeof v === 'boolean',
};

const DEFAULTS: Record<StorageKey, unknown> = {
  excludedHosts: [],
  flatProxiesList: [],
  globalProxy: {},
  globalProxyDetails: {},
  hostProxies: {},
  hostProxiesDetails: {},
  randomProxyMode: false,
};

// Missing keys fall back to defaults, but stored values that are corrupted throw: guessing could
// silently turn a proxied configuration into a direct connection.
const parseStrict = (key: StorageKey, value: unknown) => {
  if (value === undefined) return DEFAULTS[key];
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!SHAPES[key](parsed)) throw new Error(`stored "${key}" is corrupted`);
  return parsed;
};

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
  const state = Object.fromEntries(PROXY_STORAGE_KEYS.map((k) => [k, parseStrict(k, data[k])]));
  return { ...(state as Omit<ProxyState, 'randomSeed'>), randomSeed: await getRandomSeed() };
};

type Target = { script: string | null; compiled?: CompiledPac; error: string | null };

const computeTarget = async (): Promise<Target> => {
  try {
    const compiled = compilePacRules(await getProxyState());
    return {
      script: compiled.active ? buildPacScript(compiled.rules) : null,
      compiled,
      error: null,
    };
  } catch (e) {
    // Fail closed: block everything until the settings are fixed
    return { script: BLOCK_ALL_PAC, error: `Proxy settings error: ${(e as Error).message}` };
  }
};

const isIncognitoAllowed = async () => {
  try {
    return await chrome.extension.isAllowedIncognitoAccess();
  } catch {
    return false;
  }
};

const writeStatus = async ({ script, compiled, error }: Target, applyError?: string) => {
  const current = await chrome.proxy.settings.get({});
  const value = current.value as chrome.proxy.ProxyConfig | undefined;
  const applied =
    script !== null &&
    current.levelOfControl === 'controlled_by_this_extension' &&
    value?.pacScript?.data === script;

  const status: ProxyStatus = {
    active: script !== null,
    applied,
    levelOfControl: current.levelOfControl,
    controlLost: script !== null && !applied,
    error: error ?? applyError ?? null,
    issues: compiled?.issues ?? [],
    incognitoAllowed: await isIncognitoAllowed(),
  };

  const serialized = JSON.stringify(status);
  const stored = await chrome.storage.local.get(PROXY_STATUS_KEY);
  if (stored[PROXY_STATUS_KEY] !== serialized) {
    await chrome.storage.local.set({ [PROXY_STATUS_KEY]: serialized });
  }

  // Global badge warning (per-tab badges are refreshed separately and also show it)
  const broken = status.controlLost || Boolean(status.error);
  await chrome.action.setBadgeText({ text: broken ? '!' : '' });
  if (broken) await chrome.action.setBadgeBackgroundColor({ color: '#e34039' });
  return status;
};

const applyProxySettings = async () => {
  const target = await computeTarget();
  let applyError: string | undefined;
  try {
    if (target.script === null) {
      // Don't take control of the browser proxy settings when nothing is configured
      await chrome.proxy.settings.clear({ scope: 'regular' });
    } else {
      await chrome.proxy.settings.set({
        scope: 'regular',
        value: {
          mode: 'pac_script',
          // mandatory: never silently fall back to a direct connection if the PAC script fails
          pacScript: { data: target.script, mandatory: true },
        },
      });
    }
  } catch (e) {
    // e.g. not controllable (policy): reported through the status, not swallowed
    applyError = `Could not apply the proxy settings: ${(e as Error).message}`;
  }
  return writeStatus(target, applyError);
};

let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(task: () => Promise<T>) => {
  const run = queue.then(task);
  queue = run.catch((error) => console.error('Proxy settings update failed', error));
  return run;
};

// Serialise updates so the last storage state always wins
export const updateProxySettings = () => enqueue(applyProxySettings);

// Called when the effective proxy setting changes (e.g. another extension took or released
// control). Only re-applies when we may control it but don't, so our own set() doesn't loop.
export const onProxySettingsChanged = (details: { levelOfControl: string }) =>
  enqueue(async () => {
    const target = await computeTarget();
    if (target.script !== null && details.levelOfControl === 'controllable_by_this_extension') {
      return applyProxySettings();
    }
    return writeStatus(target);
  });
