![ci](https://github.com/mullvad/browser-extension/actions/workflows/ci.yml/badge.svg)

# Mullvad Browser Extension

This is a **Chrome (Manifest V3)** port of the Mullvad Browser Extension, improving your browser
experience while using Mullvad VPN. It displays information about the connection, checks for DNS and
WebRTC leaks, and gives one-click access to
[proxy servers](https://mullvad.net/en/help/socks5-proxy/) (globally, per site, or a random proxy
per site).

Mullvad ships the official extension for Firefox / Mullvad Browser
([download page](https://mullvad.net/en/download/browser/extension)); this codebase only targets
Chromium-based browsers.

## Development

### **Environment**

Build with:

- Node 24 LTS
- Npm 11

For:

- Chrome / Chromium 120 or newer

### **Developing**

The first time, use `npm install` to install the necessary packages.

- use `npm run dev` to rebuild the extension into `extension/` whenever changes are saved
- load `extension/` as an unpacked extension (`chrome://extensions` > Developer mode > "Load
  unpacked"), or use `npm start` to launch a throwaway Chromium profile with it loaded, and click
  the reload button on `chrome://extensions` after a rebuild.

The service worker can be inspected from `chrome://extensions` ("Inspect views: service worker").

### **Building**

- use `npm run build` to build the extension into `extension/`
- use `npm run pack` to create a `.zip` ready for the Chrome Web Store

### **Tests**

- `npm test` runs the unit tests (vitest), including tests that evaluate the generated PAC script.
- `e2e/` contains the end-to-end setup used to test the extension against real Mullvad servers (see
  `e2e/README.md`).

## Architecture notes (Chrome)

- **Background**: a module service worker (`src/background/main.ts`), built separately from the Vue
  pages and without any Vue/DOM dependency. All listeners are registered synchronously at the top
  level so Chrome can wake the worker for them.
- **Proxy**: Chrome has no `proxy.onRequest`, so the stored state (`globalProxy`, `hostProxies`,
  `excludedHosts`, `randomProxyMode`) is compiled into a PAC script
  (`src/helpers/socksProxy/pac.ts`) and applied with `chrome.proxy.settings` (mandatory, so a broken
  PAC never falls back to a direct connection). It is re-applied whenever that storage changes,
  permissions change, or the worker starts. When nothing is configured, the extension releases the
  proxy setting. Routing order: local/reserved addresses direct → random mode → excluded host →
  host/parent-domain proxy → global proxy → direct. Rules are matched against the requested host, so
  third-party content follows its own host's rule.
- **Random mode**: the PAC picks a relay from a hash of a per-session seed (kept in
  `chrome.storage.session`) and the site, so the pick is stable for a site and its subdomains for
  the browser session and rotates on browser restart. The site is approximated without the Public
  Suffix List (last two labels, or three for common `co.uk`-style suffixes).
- **DNS**: Chrome always resolves hostnames on the proxy for SOCKS5, so there is no "Proxy DNS"
  toggle.
- **WebRTC**: the WebRTC switch sets `privacy.network.webRTCIPHandlingPolicy` to
  `disable_non_proxied_udp` (Chrome can't disable WebRTC entirely).

### Known limitations

- The extension's own connection check (`am.i.mullvad.net`) and DNS leak check can't be forced
  through the **active tab's** proxy, since a PAC script doesn't know which tab or extension a
  request comes from. They follow the rules for `mullvad.net` itself: the global proxy (or random
  mode / a `mullvad.net` rule), not a per-site proxy of the current tab.
- Firefox-only features were removed: HTTPS-only mode and default search engine recommendations.

## Permissions

Mullvad Browser Extension requires the following permissions:

- `management` to be able to recommend third party extensions
- `privacy` to restrict WebRTC
- `proxy` to configure and use Mullvad proxy servers (can't be optional on Chrome; proxy settings
  are only changed once the optional permissions below are granted)
- `storage` to save preferences
- `*://*.mullvad.net/*` to get proxy servers list and display your connection information (See
  `Network requests` for details)

The following permissions are optional, but are needed to use the proxy feature:

- `tabs` to show proxy settings from active tab
- `<all_urls>` (optional host permission) to specify a proxy configuration per domain

## Network requests

Two external network requests are made by the extension:

- `api.mullvad.net` to get the lastest proxy servers (Frequency: each time the
  `Select proxy server location` drawer is opened)
- `am.i.mullvad.net` to get the connection information (Frequency: each time the popup is started
  and each time the proxy is connected/disconnected)

_External links are marked with this icon_
![External Link icon](https://github.com/feathericon/feathericon/blob/master/src/svg/link-external.svg)

## Source code

Source code is available in the [Github repo](https://github.com/mullvad/browser-extension).
