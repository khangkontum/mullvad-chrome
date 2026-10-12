// Route everything through a fixed Mullvad SOCKS5 relay (us-nyc-wg-socks5-001), overriding
// whatever other extensions configured.
chrome.runtime.onInstalled.addListener(() => {
  chrome.proxy.settings.set({
    scope: 'regular',
    value: {
      mode: 'fixed_servers',
      rules: { singleProxy: { scheme: 'socks5', host: '10.124.0.132', port: 1080 } },
    },
  });
});
