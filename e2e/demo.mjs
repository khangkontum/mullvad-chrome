// Demo walkthrough of the Chrome MV3 extension, recorded with ffmpeg x11grab (run inside the netns
// under Xvfb :99). Captions are written to an SRT file and burned in afterwards (see demo.sh).
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import { EXT, ART, sleep, log } from './lib.mjs';

const OUT = `${ART}/demo`;
fs.mkdirSync(OUT, { recursive: true });
const RAW = `${OUT}/demo-raw.mp4`;
const PROFILE = '/tmp/pw-demo';
fs.rmSync(PROFILE, { recursive: true, force: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--remote-debugging-port=9334',
    '--window-position=0,0',
    '--window-size=1600,1000',
    '--hide-crash-restore-bubble',
    '--force-device-scale-factor=1.4',
  ],
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const page = context.pages()[0];
await page.goto('about:blank');
await sleep(1000);

// --- recording + captions ------------------------------------------------------------------
const ffmpeg = spawn(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'x11grab',
    '-framerate',
    '25',
    '-video_size',
    '1600x1000',
    '-i',
    process.env.DISPLAY || ':99',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    RAW,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const t0 = Date.now();
const captions = [];
const caption = (text) => {
  const now = (Date.now() - t0) / 1000;
  if (captions.length) captions[captions.length - 1].end = now;
  captions.push({ start: now, end: null, text });
  log('caption', text);
};

// --- helpers -------------------------------------------------------------------------------
const go = async (url) => {
  await page.bringToFront();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);
};
const openPopup = async () => {
  await page.bringToFront();
  await sw.evaluate(() => chrome.action.openPopup());
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    // the toolbar popup is only visible to Playwright through a CDP connection
    const cdp = await chromium.connectOverCDP('http://127.0.0.1:9334');
    for (const c of cdp.contexts())
      for (const p of c.pages())
        if (p.url().includes('/dist/popup/index.html') && !p.isClosed()) {
          await sleep(2500); // let the connection check finish
          return p;
        }
  }
  throw new Error('popup not found');
};
const closePopup = async (popup) => {
  await popup.close().catch(() => {});
  await sleep(800);
};
const expand = async (popup, title) => {
  await popup.getByText(title, { exact: true }).first().click();
  await sleep(1200);
};
const pickCountry = async (popup, country) => {
  await popup
    .getByRole('button', { name: 'Select location' })
    .or(popup.getByRole('button', { name: 'Change location' }))
    .first()
    .click();
  await sleep(1800);
  const btn = popup
    .locator('.n-drawer')
    .getByRole('button', { name: country, exact: true })
    .first();
  await btn.scrollIntoViewIfNeeded();
  await sleep(1000);
  await btn.click();
  await sleep(3000);
};
const slowScroll = async (p, y) => {
  await p.mouse.wheel(0, y);
  await sleep(1500);
};

try {
  // 1. intro + baseline
  caption(
    'Mullvad Browser Extension: Chrome MV3 build in Chromium (Mullvad WireGuard runs in a network namespace)',
  );
  await go('https://am.i.mullvad.net/');
  await sleep(2000);
  caption('Baseline: connected through Mullvad WireGuard (se-sto-wg-001, Sweden)');
  await sleep(3500);

  caption(
    'Extension popup: connection check shows the Mullvad exit, DNS servers and a WebRTC check',
  );
  let popup = await openPopup();
  await sleep(4500);
  await closePopup(popup);

  // 2. permissions
  caption('Options page: proxies need the optional "tabs" + "all sites" permissions');
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extId}/dist/options/index.html`);
  await sleep(2500);
  await options.getByText('Proxy', { exact: true }).first().click();
  await sleep(2500);
  caption("Granting permissions with Chrome's native prompt");
  await options.getByText('Grant permissions').click();
  await sleep(2500);
  execSync('xdotool key Tab');
  await sleep(700);
  execSync('xdotool key Return');
  await sleep(2500);
  await options.close();

  // 3. global proxy
  caption('Popup > All websites > Select location > Switzerland');
  await go('https://am.i.mullvad.net/');
  popup = await openPopup();
  await expand(popup, 'All websites');
  await pickCountry(popup, 'Switzerland');
  caption('Global proxy set: the popup now reports a Zurich exit (SOCKS via the PAC script)');
  await sleep(4000);
  await closePopup(popup);
  caption('Reloading am.i.mullvad.net: exit is now a Swiss Mullvad SOCKS5 server');
  await go('https://am.i.mullvad.net/');
  await sleep(3500);

  // 4. per-site profiles
  caption('Per-site proxy: ipinfo.io > Current domain > Select location > Japan');
  await go('https://ipinfo.io/json');
  popup = await openPopup();
  await expand(popup, 'Current domain');
  await pickCountry(popup, 'Japan');
  await sleep(1500);
  await closePopup(popup);
  caption('ipinfo.io now exits in Japan, while other sites keep using Switzerland');
  await go('https://ipinfo.io/json');
  await sleep(3500);

  caption('Second per-site proxy: ip-api.com > Select location > USA');
  await go('http://ip-api.com/json');
  popup = await openPopup();
  await expand(popup, 'Current domain');
  await pickCountry(popup, 'USA');
  await sleep(1500);
  await closePopup(popup);
  caption('ip-api.com now exits in the USA');
  await go('http://ip-api.com/json');
  await sleep(3500);
  caption('Rules also apply to subdomains: www.ipinfo.io uses the ipinfo.io rule (Japan)');
  await go('https://www.ipinfo.io/json');
  await sleep(3000);
  caption('Sites without a rule still use the global Swiss proxy');
  await go('https://am.i.mullvad.net/');
  await sleep(3500);

  // 5. excluded site
  caption('Excluding a site: ifconfig.co is proxied through Switzerland...');
  await go('https://ifconfig.co/');
  await sleep(2500);
  popup = await openPopup();
  await expand(popup, 'Current domain');
  caption('...Current domain > Never proxy');
  await popup.getByRole('button', { name: 'Never proxy' }).first().click();
  await sleep(3000);
  await closePopup(popup);
  caption('ifconfig.co now goes direct: the WireGuard exit in Stockholm');
  await go('https://ifconfig.co/');
  await sleep(4000);

  // 6. random mode
  caption('Random mode: each site gets its own random Mullvad proxy (stable for the session)');
  await go('https://am.i.mullvad.net/');
  popup = await openPopup();
  await popup.locator('.n-switch').last().click();
  await sleep(3000);
  await closePopup(popup);
  for (const url of [
    'https://am.i.mullvad.net/',
    'https://ipinfo.io/json',
    'http://ip-api.com/json',
  ]) {
    caption(`Random mode: ${new URL(url).host}`);
    await go(url);
    await sleep(2500);
  }
  caption('Random mode off again');
  popup = await openPopup();
  await popup.locator('.n-switch').last().click();
  await sleep(2500);
  await closePopup(popup);

  // 7. DNS + WebRTC leak checks
  caption('Leak checks with the Swiss global proxy: DNS is resolved by Mullvad through the proxy');
  await go('https://am.i.mullvad.net/');
  await page
    .getByText('Check for leaks')
    .first()
    .click()
    .catch(() => {});
  await sleep(9000);
  await slowScroll(page, 400);
  await sleep(2500);
  caption('The popup flags WebRTC exposing the tunnel IP (WebRTC is not proxied by default)');
  popup = await openPopup();
  await sleep(3500);
  await closePopup(popup);
  caption(
    'Options > Settings: turn the WebRTC switch off (webRTCIPHandlingPolicy = disable_non_proxied_udp)',
  );
  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extId}/dist/options/index.html`);
  await sleep(1500);
  await opts.getByText('Settings', { exact: true }).first().click();
  await sleep(2000);
  await opts.locator('#webrtc-leak .n-switch').click();
  await sleep(3000);
  await opts.close();
  caption('WebRTC no longer leaks any IP');
  await go('https://am.i.mullvad.net/');
  popup = await openPopup();
  await sleep(4000);
  await closePopup(popup);

  // 8. options page
  caption('Options > Proxy: all configured per-site proxies and exclusions');
  const o2 = await context.newPage();
  await o2.goto(`chrome-extension://${extId}/dist/options/index.html`);
  await sleep(1500);
  await o2.getByText('Proxy', { exact: true }).first().click();
  await sleep(2000);
  for (const host of ['ipinfo.io', 'ip-api.com', 'ifconfig.co']) {
    await o2
      .getByText(host, { exact: true })
      .first()
      .click()
      .catch(() => {});
    await sleep(1200);
  }
  await sleep(2500);
  caption('Options > Import/Export: settings can be exported and imported as JSON');
  await o2.getByText('Import/Export', { exact: true }).first().click();
  await sleep(4500);
  caption('Options > About');
  await o2.getByText('About', { exact: true }).first().click();
  await sleep(3000);
  caption('Done: global, per-site, excluded and random proxies via a PAC script on Chrome MV3');
  await sleep(3500);
} finally {
  captions[captions.length - 1].end = (Date.now() - t0) / 1000;
  ffmpeg.stdin.write('q');
  await new Promise((r) => ffmpeg.on('close', r));
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
  };
  fs.writeFileSync(
    `${OUT}/captions.srt`,
    captions.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n'),
  );
  await context.close();
}
