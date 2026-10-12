import { normalizeHost } from '@/helpers/domain';
import { toPacProxy } from '@/helpers/socksProxy/pac';
import type {
  ProxyDetails,
  ProxyDetailsMap,
  ProxyInfo,
  ProxyInfoMap,
} from '@/helpers/socksProxy/socksProxy.types';

export type ImportedSettings = {
  excludedHosts: string[];
  globalProxy: ProxyInfo | Record<string, never>;
  globalProxyDetails: ProxyDetails | Record<string, never>;
  hostProxies: ProxyInfoMap;
  hostProxiesDetails: ProxyDetailsMap;
};

export type ValidationResult =
  | { ok: true; value: ImportedSettings }
  | { ok: false; errors: string[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const OPTIONAL_STRINGS = ['country', 'countryCode', 'city', 'server'] as const;

const validateDetails = (v: unknown, where: string, errors: string[]): ProxyDetails | null => {
  if (!isPlainObject(v)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  if (typeof v.socksEnabled !== 'boolean') {
    errors.push(`${where}.socksEnabled: must be true or false`);
    return null;
  }
  for (const key of OPTIONAL_STRINGS) {
    if (v[key] !== undefined && typeof v[key] !== 'string') {
      errors.push(`${where}.${key}: must be a string`);
      return null;
    }
  }
  return v as ProxyDetails;
};

const validateProxy = (v: unknown, where: string, errors: string[]): ProxyInfo | null => {
  if (!isPlainObject(v) || !toPacProxy(v as Partial<ProxyInfo>)) {
    errors.push(`${where}: must be a SOCKS proxy with a valid host and port (1-65535)`);
    return null;
  }
  return { ...(v as ProxyInfo), host: normalizeHost(v.host)! };
};

/** Validates (and normalizes hosts of) an imported settings file. Nothing partial is accepted. */
export const validateImportedSettings = (data: unknown): ValidationResult => {
  const errors: string[] = [];
  if (!isPlainObject(data)) return { ok: false, errors: ['The file must contain a JSON object'] };

  const excludedHosts: string[] = [];
  if (!Array.isArray(data.excludedHosts)) {
    errors.push('excludedHosts: must be a list of sites');
  } else {
    data.excludedHosts.forEach((host, i) => {
      const h = normalizeHost(host);
      if (h) excludedHosts.push(h);
      else errors.push(`excludedHosts[${i}]: invalid site "${String(host)}"`);
    });
  }

  let globalProxyDetails: ImportedSettings['globalProxyDetails'] = {};
  let globalProxy: ImportedSettings['globalProxy'] = {};
  if (!isPlainObject(data.globalProxyDetails) || !isPlainObject(data.globalProxy)) {
    errors.push('globalProxy and globalProxyDetails: must be objects');
  } else if (Object.keys(data.globalProxyDetails).length > 0) {
    const details = validateDetails(data.globalProxyDetails, 'globalProxyDetails', errors);
    if (details) {
      globalProxyDetails = details;
      // a configured global proxy must be usable, even when disabled
      const proxy = validateProxy(data.globalProxy, 'globalProxy', errors);
      if (proxy) globalProxy = proxy;
    }
  } else if (Object.keys(data.globalProxy).length > 0) {
    errors.push('globalProxy: set without globalProxyDetails');
  }

  const hostProxies: ProxyInfoMap = {};
  const hostProxiesDetails: ProxyDetailsMap = {};
  if (!isPlainObject(data.hostProxies) || !isPlainObject(data.hostProxiesDetails)) {
    errors.push('hostProxies and hostProxiesDetails: must be objects');
  } else {
    const hosts = new Set([
      ...Object.keys(data.hostProxies),
      ...Object.keys(data.hostProxiesDetails),
    ]);
    for (const key of hosts) {
      const h = normalizeHost(key);
      if (!h) {
        errors.push(`hostProxies: invalid site "${key}"`);
        continue;
      }
      if (!(key in data.hostProxies) || !(key in data.hostProxiesDetails)) {
        errors.push(`${h}: needs both a proxy and its details`);
        continue;
      }
      const details = validateDetails(
        data.hostProxiesDetails[key],
        `hostProxiesDetails.${h}`,
        errors,
      );
      const proxy = validateProxy(data.hostProxies[key], `hostProxies.${h}`, errors);
      if (details && proxy) {
        hostProxies[h] = proxy;
        hostProxiesDetails[h] = details;
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { excludedHosts, globalProxy, globalProxyDetails, hostProxies, hostProxiesDetails },
  };
};
