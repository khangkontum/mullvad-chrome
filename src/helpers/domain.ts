import ipaddr from 'ipaddr.js';
import { parse } from 'tldts';

export const checkDomain = (host: string) => {
  const parsed = parse(host, { detectSpecialUse: true });
  return {
    hasSubdomain: Boolean(parsed.subdomain),
    fullHost: host,
    domain: parsed.domain || host,
  };
};

export const isValidDomain = (domain: string): boolean => {
  // Handle special-use domains (localhost, test, invalid, example, local, onion, alt and home.arpa)
  const parsed = parse(domain, { detectSpecialUse: true });

  return Boolean(parsed.isSpecialUse || (parsed.domain && parsed.isIcann));
};

export const normalizeToFQDN = (input: string): string | null => {
  const parsed = parse(input);
  return parsed.hostname || null;
};

export const truncateHost = (host: string, maxLength = 21): string => {
  if (!host || host.length <= maxLength) {
    return host;
  }

  return host.slice(0, maxLength - 1) + '…';
};

/**
 * Canonical form of a host as Chrome hands it to the PAC script: trimmed, lowercase, punycode,
 * without trailing dot or IPv6 brackets. Returns null for anything that isn't a bare host
 * (ports, paths, credentials, whitespace or characters that can't be in a hostname).
 */
export const normalizeHost = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || /[\s/\\@?#]/.test(raw)) return null;
  if (ipaddr.IPv6.isValid(raw)) return ipaddr.IPv6.parse(raw).toString();

  let url: URL;
  try {
    url = new URL(`http://${raw}`);
  } catch {
    return null;
  }
  if (url.port || url.username || url.password || url.pathname !== '/') return null;

  let host = url.hostname.replace(/\.$/, '');
  if (host.startsWith('[')) host = host.slice(1, -1);
  if (!host || host.length > 253) return null;
  if (host.includes(':')) return ipaddr.IPv6.isValid(host) ? host : null;
  return /^[a-z0-9_.-]+$/.test(host) && !host.startsWith('.') && !host.includes('..') ? host : null;
};

/** Site typed by the user (host or URL), in the canonical form used for proxy rules. */
export const normalizeUserHost = (input: string): string | null =>
  normalizeHost(normalizeToFQDN(input.trim()) ?? '');
