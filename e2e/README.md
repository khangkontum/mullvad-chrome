# End-to-end tests (Chrome MV3)

Tests the built extension (`../extension`) in Playwright's Chromium against real Mullvad servers.

The machine's own routing is never touched: Mullvad WireGuard runs **only inside a network
namespace** (`mlvd`), and the browser, Xvfb and ffmpeg run inside it as the normal user. The Mullvad
SOCKS5 relays (`10.64.0.1`, `10.124.x.x`) are only reachable through that tunnel.

## Setup

Requirements: `sudo`, kernel WireGuard, `wireguard-tools`, `xvfb`, `xdotool`, `ffmpeg`, ImageMagick
(`import`), Python 3, Node.

```sh
npm install && npx playwright install chromium
# account number: only stored in a gitignored, chmod 600 .env (never printed)
umask 077; printf 'MULLVAD_ACCOUNT=%s\n' "$MULLVAD_ACCOUNT" > .env
npm run tunnel:up        # registers a WireGuard key with the account, brings up netns `mlvd`
./ns.sh bash -c 'Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp &'
(cd .. && npm run build)
```

## Run

```sh
npm test        # chrome.e2e.mjs: assertions, screenshots + log in artifacts/
npm run demo    # demo.mjs: captioned walkthrough → artifacts/demo/mullvad-chrome-mv3-demo.mp4
```

## Teardown

```sh
npm run tunnel:down        # delete the namespace
npm run tunnel:deregister  # remove the WireGuard key/device from the account
```

## What is checked (`chrome.e2e.mjs`)

- optional permissions granted through Chrome's native prompt (accepted with xdotool)
- baseline exit is the WireGuard relay; no rules → proxy settings left to the system
- global proxy (CH/JP/US/DE): `am.i.mullvad.net` reports the selected SOCKS5 relay; PAC is
  controlled by the extension and mandatory; toolbar badge shows the country
- per-site rules (ipinfo.io → JP, ip-api.com → US), subdomains inherit domain rules (ipify.org →
  api.ipify.org, mullvad.net → am.i.mullvad.net)
- third-party requests from a proxied page are routed by the **requested** host (direct/global, or
  their own rule)
- excluded hosts (and subdomains of excluded domains) go direct even with global/host rules
- random mode: Mullvad relay per site, stable per site, different sites spread over relays
- service worker stopped via `chrome://serviceworker-internals`: the random pick survives a restart,
  and a storage change wakes the worker which applies the new PAC
- DNS leak check: all resolvers are Mullvad
- WebRTC: STUN exposes the non-proxied exit by default; the extension's toggle sets
  `webRTCIPHandlingPolicy=disable_non_proxied_udp` and no IP is exposed anymore
- popup connection check shows the proxied exit
- the live PAC script from `chrome.proxy.settings` evaluates correctly in a VM
- proxy status: applied/in control; Incognito warning shown (no incognito access)
- an enabled rule with an invalid proxy (PAC injection attempt) blocks the site, others unaffected
- corrupted stored settings block all traffic, popup shows the error and `!` badge, reset recovers
- malformed settings import is rejected without writing; a valid one (uppercase hosts) applies
- random mode keeps the same relays across popup opens (relay list refetch)
- random mode with an empty relay list blocks traffic but keeps `api.mullvad.net` reachable, and
  opening the popup loads the list
- a second extension (`fixtures/proxy-hijacker`, loaded at runtime through CDP) taking over the
  proxy settings is detected (status, `!` badge, popup warning); disabling it restores our PAC
- revoking `<all_urls>` (site access "on click") keeps the proxy applied
