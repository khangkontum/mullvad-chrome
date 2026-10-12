import { parseStored } from '@/helpers/storage';

// Static fallback for base conncheck URL
const CONNCHECK_URL = 'am.i.mullvad.net';
export const CONFIG_ENDPOINT = `https://${CONNCHECK_URL}/config`;

export type ConnCheckConfig = {
  dns_leak_domain: string;
  ipv4_url: string;
  ipv6_url: string;
};

export const DEFAULT_CONFIG: ConnCheckConfig = {
  dns_leak_domain: `dnsleak.${CONNCHECK_URL}`,
  ipv4_url: `https://ipv4.${CONNCHECK_URL}`,
  ipv6_url: `https://ipv6.${CONNCHECK_URL}`,
};

export const getConfig = async (): Promise<ConnCheckConfig> => {
  const { connCheckConfig } = await chrome.storage.local.get('connCheckConfig');

  return { ...DEFAULT_CONFIG, ...parseStored<Partial<ConnCheckConfig>>(connCheckConfig, {}) };
};

export const initConfig = async (): Promise<ConnCheckConfig> => {
  try {
    const response = await fetch(CONFIG_ENDPOINT, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Error fetching conncheck config: ${response.status}`);
    }
    const config: Partial<ConnCheckConfig> = await response.json();
    const merged = { ...DEFAULT_CONFIG, ...config };
    await chrome.storage.local.set({ connCheckConfig: JSON.stringify(merged) });
    return merged;
  } catch {
    return getConfig();
  }
};
