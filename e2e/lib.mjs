import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const EXT = path.resolve(HERE, '../extension');
export const ART = path.resolve(HERE, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const log = (...a) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(path.join(ART, 'e2e.log'), line + '\n');
};

export const HIJACKER = path.resolve(HERE, 'fixtures/proxy-hijacker');
export const CDP_PORT = 9335;

export async function launch({ profile = '/tmp/pw-profile', video = false, fresh = true } = {}) {
  if (fresh) {
    fs.rmSync(profile, { recursive: true, force: true });
    // Proxied sites are resolved locally (PAC "SOCKS"), so use Mullvad DoH like a real user
    // would, instead of depending on the tunnel relay's plain DNS.
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'Local State'),
      JSON.stringify({
        dns_over_https: { mode: 'secure', templates: 'https://dns.mullvad.net/dns-query' },
      }),
    );
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: false,
    // allow loading the test fixture extension at runtime (instead of --disable-extensions-except)
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 860 },
    args: [
      `--load-extension=${EXT}`,
      // for loading the test fixture extension later (CDP Extensions.loadUnpacked) and
      // reaching the toolbar popup through CDP
      `--remote-debugging-port=${CDP_PORT}`,
      '--enable-unsafe-extension-debugging',
      '--window-position=0,0',
      '--window-size=1280,960',
    ],
    ...(video
      ? { recordVideo: { dir: path.join(ART, 'video'), size: { width: 1280, height: 860 } } }
      : {}),
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  return { context, sw, extId };
}

export const getSW = async (context) => {
  const sws = context.serviceWorkers();
  return sws.length ? sws[sws.length - 1] : context.waitForEvent('serviceworker');
};

// The optional-permission prompt is a native dialog with "Deny" focused: Tab to "Allow", Enter.
export async function acceptPermissionPrompt(name = 'permission-prompt') {
  await sleep(2000);
  screenshotScreen(name);
  execSync('xdotool key Tab');
  await sleep(300);
  execSync('xdotool key Return');
  await sleep(1000);
}

export function screenshotScreen(name) {
  execSync(`import -window root ${path.join(ART, name + '.png')}`);
}

// Fetch exit info by navigating a tab (so the PAC script applies to a real page load).
export async function exitInfo(page, url = 'https://am.i.mullvad.net/json') {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const text = await page.locator('body').innerText();
  return JSON.parse(text);
}

// Playwright only exposes the toolbar popup through a CDP connection
export async function cdpBrowser() {
  return chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
}

export async function openToolbarPopup(sw, page) {
  await page.bringToFront();
  await sw.evaluate(() => chrome.action.openPopup());
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const browser = await cdpBrowser();
    for (const c of browser.contexts())
      for (const p of c.pages())
        if (p.url().includes('/dist/popup/index.html') && !p.isClosed()) return p;
  }
  throw new Error('toolbar popup not found');
}
