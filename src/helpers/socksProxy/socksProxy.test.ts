import { it, describe, expect } from 'vitest';

import { isLocalOrReservedIP } from '@/helpers/socksProxy/socksProxy';

describe('isLocalOrReservedIP', () => {
  it('should return true for localhost', () => {
    expect(isLocalOrReservedIP('localhost:8080')).toBeTruthy();
  });

  it('should return true for private IP', () => {
    expect(isLocalOrReservedIP('192.168.1.1')).toBeTruthy();
  });

  it('should return true for loopback IP', () => {
    expect(isLocalOrReservedIP('127.0.0.1')).toBeTruthy();
    expect(isLocalOrReservedIP('::1')).toBeTruthy();
  });

  it('should return true for bracketed IPv6', () => {
    expect(isLocalOrReservedIP('[::1]')).toBeTruthy();
    expect(isLocalOrReservedIP('[fc00::1]')).toBeTruthy();
  });

  it('should return false for public IP', () => {
    expect(isLocalOrReservedIP('8.8.8.8')).toBeFalsy();
  });

  it('should return false for domains that contain the localhost substring', () => {
    expect(isLocalOrReservedIP('notlocalhost.com')).toBeFalsy();
    expect(isLocalOrReservedIP('localhost.attacker.tld')).toBeFalsy();
    expect(isLocalOrReservedIP('prod-localhost-cdn.example')).toBeFalsy();
  });

  it('should return false for invalid IP', () => {
    expect(isLocalOrReservedIP('invalid.ip')).toBeFalsy();
  });

  it('should return true for unique local addresses', () => {
    expect(isLocalOrReservedIP('fc00::')).toBeTruthy();
  });

  it('should return true for multicast addresses', () => {
    expect(isLocalOrReservedIP('ff00::')).toBeTruthy();
  });

  it('should return false when IP address is not provided', () => {
    expect(isLocalOrReservedIP('')).toBeFalsy();
  });
});
