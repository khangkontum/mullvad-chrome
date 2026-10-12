export enum ProxyInfoType {
  direct = 'direct',
  http = 'http',
  https = 'https',
  socks = 'socks',
  socks4 = 'socks4',
}

export type ProxyInfo = {
  type: ProxyInfoType;
  host: string;
  port: number;
  proxyDNS?: boolean; // Firefox only; ignored in Chrome (PAC "SOCKS" always resolves locally)

  /*
  This is the full type of ProxyInfo,
  but since we don't need it, then we can ignore it.
  Keeping it here for reference and to troubleshoot if needs be.

  username?: string; // only if type is 'socks'
  password?: string; // only if type is 'socks'
  failoverTimeout?: number;
  proxyAuthorizationHeader?: string;
  connectionIsolationKey?: string; // only if type is 'https'
  */
};

export type ProxyInfoMap = {
  [key: string]: ProxyInfo;
};

export type ProxyDetails = {
  socksEnabled: boolean;
  country?: string;
  countryCode?: string;
  city?: string;
  server?: string;
  proxyDNS?: boolean;
};

export type ProxyDetailsMap = {
  [key: string]: ProxyDetails;
};

export interface ProxyOperationArgs {
  country: string;
  countryCode: string;
  city?: string;
  hostname: string;
  ipv4_address: string;
  port?: number;
}
