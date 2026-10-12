import ipaddr from 'ipaddr.js';
import { parse } from 'tldts';

export const isLocalOrReservedIP = (hostname: string) => {
  //Parse with `tldts` to normalize the host (it strips the brackets for IPv6 and lowercases),
  // and to match "localhost" via the special-use flag.
  const parsed = parse(hostname, { detectSpecialUse: true });
  const normalizedHost = parsed.hostname;
  if (!normalizedHost) return false;
  if (parsed.isSpecialUse && normalizedHost === 'localhost') return true;
  if (!ipaddr.isValid(normalizedHost)) return false;

  try {
    const addr = ipaddr.parse(normalizedHost);
    const range = addr.range();

    return (
      range === 'private' ||
      range === 'multicast' ||
      range === 'linkLocal' ||
      range === 'loopback' ||
      range === 'uniqueLocal'
    );
  } catch (e: unknown) {
    console.error('Invalid IP address:', e);
    return false;
  }
};
