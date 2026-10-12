// End-to-end test of the Chrome MV3 Mullvad extension, run inside the Mullvad WireGuard netns.
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import {
  launch,
  acceptPermissionPrompt,
  ART,
  sleep,
  log,
  getSW,
  cdpBrowser,
  openToolbarPopup,
  HIJACKER,
} from './lib.mjs';

fs.rmSync(`${ART}/e2e.log`, { force: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const RELAYS = {
  CH: {
    host: '10.124.0.241',
    name: 'ch-zrh-wg-socks5-001',
    country: 'Switzerland',
    city: 'Zurich',
    cc: 'ch',
  },
  JP: {
    host: '10.124.1.218',
    name: 'jp-tyo-wg-socks5-001',
    country: 'Japan',
    city: 'Tokyo',
    cc: 'jp',
  },
  US: {
    host: '10.124.0.132',
    name: 'us-nyc-wg-socks5-001',
    country: 'USA',
    city: 'New York, NY',
    cc: 'us',
  },
  DE: {
    host: '10.124.0.53',
    name: 'de-fra-wg-socks5-001',
    country: 'Germany',
    city: 'Frankfurt',
    cc: 'de',
  },
};
const info = (r) => ({ type: 'socks', host: r.host, port: 1080, proxyDNS: true });
const details = (r) => ({
  socksEnabled: true,
  server: r.name,
  country: r.country,
  countryCode: r.cc,
  city: r.city,
  proxyDNS: true,
});

const EMPTY = {
  globalProxy: {},
  globalProxyDetails: { socksEnabled: false },
  hostProxies: {},
  hostProxiesDetails: {},
  excludedHosts: [],
  randomProxyMode: false,
};

const { context, extId } = await launch();
const sw = await getSW(context);
log('extension id', extId);

// Write extension state the same way the UI does (JSON strings in chrome.storage.local),
// via an extension page so the service worker reacts through storage.onChanged.
const extPage = await context.newPage();
await extPage.goto(`chrome-extension://${extId}/dist/options/index.html`);
const setState = async (state) => {
  const s = { ...EMPTY, ...state };
  const before = await extPage.evaluate(async () => (await chrome.proxy.settings.get({})).value);
  await extPage.evaluate(
    (entries) => chrome.storage.local.set(Object.fromEntries(entries)),
    Object.entries(s).map(([k, v]) => [k, JSON.stringify(v)]),
  );
  // wait until the service worker re-applied the proxy settings
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const now = await extPage.evaluate(async () => (await chrome.proxy.settings.get({})).value);
    if (JSON.stringify(now) !== JSON.stringify(before)) break;
  }
  await sleep(300);
};
const proxySettings = () => extPage.evaluate(() => chrome.proxy.settings.get({}));

const page = await context.newPage();
const getJSON = async (url, attempt = 0) => {
  const sep = url.includes('?') ? '&' : '?';
  const res = await page.goto(`${url}${sep}_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  // third-party IP echo services occasionally rate-limit shared exit IPs
  if (res.status() === 429 && attempt < 2) {
    log(`429 from ${url}, retrying`);
    await sleep(4000);
    return getJSON(url, attempt + 1);
  }
  if (!res.ok()) throw new Error(`${url}: HTTP ${res.status()}`);
  return JSON.parse(await page.locator('body').innerText());
};
const amI = () => getJSON('https://am.i.mullvad.net/json');
const shot = (name, p = page) => p.screenshot({ path: `${ART}/${name}.png` });
const getStatus = async () =>
  JSON.parse(
    (await extPage.evaluate(() => chrome.storage.local.get('proxyStatus'))).proxyStatus ?? '{}',
  );
const waitStatus = async (pred, timeout = 8000) => {
  const start = Date.now();
  let status;
  while (Date.now() - start < timeout) {
    status = await getStatus();
    if (pred(status)) return status;
    await sleep(200);
  }
  return status;
};
// true if the request fails at the network level (blocked by the PAC / proxy)
const isBlocked = async (url) => {
  let result = false;
  try {
    await page.goto(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, { timeout: 20000 });
  } catch (e) {
    const m = e.message.match(/net::ERR_(PROXY|SOCKS|TUNNEL|CONNECTION|EMPTY)\w*/);
    result = m ? m[0] : false;
  }
  // leave the chrome-error page so the next navigation isn't interrupted
  await page.goto('about:blank').catch(() => {});
  await sleep(300);
  return result;
};
const openPopupTab = async () => {
  const p = await context.newPage();
  await p.setViewportSize({ width: 480, height: 900 });
  await p.goto(`chrome-extension://${extId}/dist/popup/index.html`);
  await sleep(2500);
  return p;
};

// --- 0. permissions + baseline -------------------------------------------------------------
await extPage.getByText('Proxy', { exact: true }).first().click();
await extPage.getByText('Grant permissions').click();
await acceptPermissionPrompt();
check(
  'optional permissions granted (tabs + <all_urls>) via native prompt',
  await extPage.evaluate(() =>
    chrome.permissions.contains({ permissions: ['tabs'], origins: ['<all_urls>'] }),
  ),
);

const base = await amI();
const WG_EXIT = base.ip;
check(
  'baseline exit is Mullvad WireGuard (netns tunnel)',
  base.mullvad_exit_ip && base.mullvad_server_type === 'WireGuard',
  `${base.ip} ${base.mullvad_exit_ip_hostname} ${base.country}`,
);
await shot('00-baseline-am-i-mullvad');
let ps = await proxySettings();
check(
  'no rules → extension does not take over proxy settings',
  ps.levelOfControl === 'controllable_by_this_extension' && ps.value.mode === 'system',
  JSON.stringify(ps),
);

// relay list for random mode (the popup normally stores it)
const flat = await sw.evaluate(async () => {
  const data = await (await fetch('https://api.mullvad.net/network/v1-beta1/socks-proxies')).json();
  return data.filter((p) => p.online && p.ipv4_address && p.hostname);
});
log('relay list size', flat.length);
await extPage.evaluate(
  (list) => chrome.storage.local.set({ flatProxiesList: JSON.stringify(list) }),
  flat,
);

// --- 1. global proxy -----------------------------------------------------------------------
const exitIp = {};
for (const cc of ['CH', 'JP', 'US', 'DE']) {
  await setState({ globalProxy: info(RELAYS[cc]), globalProxyDetails: details(RELAYS[cc]) });
  const r = await amI();
  exitIp[cc] = r.ip;
  check(
    `global proxy ${cc} → exit ${RELAYS[cc].name}`,
    r.mullvad_exit_ip_hostname === RELAYS[cc].name &&
      r.mullvad_server_type === 'SOCKS through WireGuard',
    `${r.ip} ${r.country} ${r.mullvad_exit_ip_hostname}`,
  );
  if (cc === 'CH') await shot('01-global-ch');
}
ps = await proxySettings();
check(
  'PAC applied and controlled by this extension',
  ps.levelOfControl === 'controlled_by_this_extension' &&
    ps.value.mode === 'pac_script' &&
    ps.value.pacScript.mandatory === true,
);
fs.writeFileSync(`${ART}/pac-global-de.js`, ps.value.pacScript.data);

// The PAC script Chrome actually holds (emitted by the built bundle) evaluates correctly
{
  const ctx = vm.createContext({});
  vm.runInContext(ps.value.pacScript.data, ctx);
  const cases = [
    ['https://am.i.mullvad.net/json', `SOCKS5 ${RELAYS.DE.host}:1080`],
    ['https://WWW.Example.com/', `SOCKS5 ${RELAYS.DE.host}:1080`],
    ['http://192.168.1.1/', 'DIRECT'],
    ['http://localhost:8080/', 'DIRECT'],
  ];
  const got = cases.map(([url]) => ctx.FindProxyForURL(url, new URL(url).hostname));
  check(
    'live PAC script from chrome.proxy.settings evaluates correctly in a VM',
    cases.every(([, expected], i) => got[i] === expected),
    JSON.stringify(got),
  );
}
const status1 = await getStatus();
check(
  'proxy status: applied, in control, incognito access missing',
  status1.applied && !status1.controlLost && !status1.error && status1.incognitoAllowed === false,
  JSON.stringify(status1),
);

// badge reflects the global proxy for the active tab
await page.bringToFront();
await sleep(500);
const badge = await sw.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return chrome.action.getBadgeText({ tabId: tab.id });
});
check('toolbar badge shows proxy country for active tab', badge === 'DE', `badge=${badge}`);

// --- 2. per-site rules ---------------------------------------------------------------------
await setState({
  globalProxy: info(RELAYS.CH),
  globalProxyDetails: details(RELAYS.CH),
  hostProxies: { 'ipinfo.io': info(RELAYS.JP), 'ip-api.com': info(RELAYS.US) },
  hostProxiesDetails: { 'ipinfo.io': details(RELAYS.JP), 'ip-api.com': details(RELAYS.US) },
});
const ipinfo = await getJSON('https://ipinfo.io/json');
check(
  'per-site rule ipinfo.io → Japan',
  ipinfo.country === 'JP' && ipinfo.ip === exitIp.JP,
  `${ipinfo.ip} ${ipinfo.country} ${ipinfo.city}`,
);
await shot('02-per-site-ipinfo-jp');
const ipapi = await getJSON('http://ip-api.com/json');
check(
  'per-site rule ip-api.com → USA',
  ipapi.countryCode === 'US' && ipapi.query === exitIp.US,
  `${ipapi.query} ${ipapi.country} ${ipapi.city}`,
);
await shot('02-per-site-ipapi-us');
const g = await amI();
check(
  'site without rule uses global proxy (CH)',
  g.mullvad_exit_ip_hostname === RELAYS.CH.name,
  g.mullvad_exit_ip_hostname,
);

// (a) rule on a registrable domain applies to subdomains
await setState({
  hostProxies: { 'ipify.org': info(RELAYS.JP), 'mullvad.net': info(RELAYS.DE) },
  hostProxiesDetails: { 'ipify.org': details(RELAYS.JP), 'mullvad.net': details(RELAYS.DE) },
});
const ipify = await getJSON('https://api.ipify.org?format=json');
check('rule on ipify.org applies to api.ipify.org (JP exit IP)', ipify.ip === exitIp.JP, ipify.ip);
const sub = await amI();
check(
  'rule on mullvad.net applies to am.i.mullvad.net (Germany)',
  sub.mullvad_exit_ip_hostname === RELAYS.DE.name,
  `${sub.country} ${sub.mullvad_exit_ip_hostname}`,
);
await shot('03-subdomain-rule-de');

// (b) third-party content embedded in a proxied site is routed by the requested host
for (const withGlobal of [false, true]) {
  await setState({
    ...(withGlobal ? { globalProxy: info(RELAYS.CH), globalProxyDetails: details(RELAYS.CH) } : {}),
    hostProxies: { 'example.com': info(RELAYS.JP), 'ipinfo.io': info(RELAYS.US) },
    hostProxiesDetails: { 'example.com': details(RELAYS.JP), 'ipinfo.io': details(RELAYS.US) },
  });
  await page.goto(`https://example.com/?_=${Date.now()}`);
  const thirdParty = await page.evaluate(async () => {
    const ipify = await (await fetch(`https://api.ipify.org?format=json&_=${Date.now()}`)).json();
    const ipinfo = await (await fetch(`https://ipinfo.io/json?_=${Date.now()}`)).json();
    return { ipify: ipify.ip, ipinfo: { ip: ipinfo.ip, country: ipinfo.country } };
  });
  const expected = withGlobal ? exitIp.CH : WG_EXIT;
  check(
    `third-party host without rule, embedded in proxied example.com (JP), goes ${withGlobal ? 'via global CH' : 'direct'}`,
    thirdParty.ipify === expected && thirdParty.ipify !== exitIp.JP,
    `api.ipify.org saw ${thirdParty.ipify}, expected ${expected}`,
  );
  check(
    `third-party host with its own rule (ipinfo.io → US) uses that rule${withGlobal ? ' (global on)' : ''}`,
    thirdParty.ipinfo.country === 'US' && thirdParty.ipinfo.ip === exitIp.US,
    JSON.stringify(thirdParty.ipinfo),
  );
}
// --- 3. excluded hosts ---------------------------------------------------------------------
await setState({
  globalProxy: info(RELAYS.CH),
  globalProxyDetails: details(RELAYS.CH),
  excludedHosts: ['ifconfig.co', 'mullvad.net'],
  hostProxies: { 'ifconfig.co': info(RELAYS.US) },
  hostProxiesDetails: { 'ifconfig.co': details(RELAYS.US) },
});
const ex1 = await getJSON('https://ifconfig.co/json');
check(
  'excluded ifconfig.co goes direct despite global + host rule',
  ex1.ip === WG_EXIT,
  `${ex1.ip} ${ex1.country}`,
);
const ex2 = await amI();
check(
  'excluded mullvad.net also excludes am.i.mullvad.net',
  ex2.mullvad_exit_ip_hostname === base.mullvad_exit_ip_hostname,
  ex2.mullvad_exit_ip_hostname,
);
await shot('04-excluded-direct');
const ex3 = await getJSON('https://ipinfo.io/json');
check('non-excluded host still uses global CH', ex3.ip === exitIp.CH, ex3.ip);

// --- 4. random mode ------------------------------------------------------------------------
await setState({ randomProxyMode: true, excludedHosts: ['mullvad.net'] });
const r1 = await amI();
const r2 = await amI();
const rIpinfo = await getJSON('https://api.ipify.org?format=json');
const rIfc = await getJSON('https://ifconfig.co/json');
const rIfc2 = await getJSON('https://ifconfig.co/json');
check(
  'random mode: am.i.mullvad.net exits via a Mullvad SOCKS relay (overrides exclusions)',
  r1.mullvad_server_type === 'SOCKS through WireGuard',
  r1.mullvad_exit_ip_hostname,
);
check(
  'random mode: stable pick per site',
  r1.mullvad_exit_ip_hostname === r2.mullvad_exit_ip_hostname && rIfc.ip === rIfc2.ip,
  `${r1.mullvad_exit_ip_hostname}; ifconfig.co ${rIfc.ip}`,
);
check(
  'random mode: sites spread over different relays',
  new Set([r1.ip, rIpinfo.ip, rIfc.ip]).size >= 2,
  `am.i ${r1.country}, ipify ${rIpinfo.ip}, ifconfig ${rIfc.country}`,
);
await shot('05-random-mode');

// --- 5. service worker restart -------------------------------------------------------------
const internals = await context.newPage();
await internals.goto('chrome://serviceworker-internals/');
await sleep(1000);
// (no reload: reloading the tab fires tabs.onUpdated, which would itself wake the worker)
const swStatus = async () => {
  await sleep(800);
  return (await internals.locator('body').innerText()).match(/Running Status: (\w+)/)?.[1];
};
const stopSW = async (label) => {
  await internals.bringToFront();
  await internals.getByText('Stop', { exact: true }).first().click();
  const status = await swStatus();
  await internals.screenshot({ path: `${ART}/08-sw-stopped-${label}.png` });
  check(
    `service worker stopped via chrome://serviceworker-internals (${label})`,
    status === 'STOPPED',
    status,
  );
};
log('service worker status before stop:', await swStatus());
await stopSW('1');
await page.bringToFront();
const afterStop = await amI();
check(
  'after SW restart: random pick unchanged (seed kept in storage.session)',
  afterStop.mullvad_exit_ip_hostname === r1.mullvad_exit_ip_hostname,
  afterStop.mullvad_exit_ip_hostname,
);
await stopSW('2');
// a storage change (from the options page) must wake the worker via its top-level
// storage.onChanged listener and re-apply the PAC script
await setState({ globalProxy: info(RELAYS.JP), globalProxyDetails: details(RELAYS.JP) });
const restarted = await swStatus();
await internals.screenshot({ path: `${ART}/08-sw-restarted.png` });
check('service worker was woken up again by the storage event', restarted === 'RUNNING', restarted);
await page.bringToFront();
const woke = await amI();
check(
  'after SW stop: new PAC from the woken worker applies (JP)',
  woke.mullvad_exit_ip_hostname === RELAYS.JP.name,
  woke.mullvad_exit_ip_hostname,
);
await internals.close();

// --- 6. DNS leak ---------------------------------------------------------------------------
await setState({ globalProxy: info(RELAYS.CH), globalProxyDetails: details(RELAYS.CH) });
const dns = [];
for (let i = 0; i < 4; i++) {
  // same request as the extension's own DNS leak check (extension page, Accept: application/json)
  const uuid = randomUUID();
  dns.push(
    ...(await extPage.evaluate(
      async (u) =>
        (
          await fetch(`https://${u}.dnsleak.am.i.mullvad.net/`, {
            headers: { Accept: 'application/json' },
          })
        ).json(),
      uuid,
    )),
  );
}
const dnsHosts = [
  ...new Set(dns.map((d) => `${d.hostname || d.ip} (${d.country}, mullvad_dns=${d.mullvad_dns})`)),
];
check(
  'DNS leak test (global CH): all resolvers are Mullvad',
  dns.length > 0 && dns.every((d) => d.mullvad_dns),
  dnsHosts.join('; '),
);

// --- 7. WebRTC -----------------------------------------------------------------------------
const gatherIce = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        const cands = [];
        pc.onicecandidate = (e) => {
          if (e.candidate) cands.push(e.candidate.candidate);
          else resolve(cands);
        };
        pc.createDataChannel('x');
        pc.createOffer().then((o) => pc.setLocalDescription(o));
        setTimeout(() => resolve(cands), 8000);
      }),
  );
await page.goto('https://am.i.mullvad.net/');
const iceBefore = await gatherIce();
const leaked = iceBefore.filter((c) => c.includes(WG_EXIT) || / typ srflx /.test(c));
log('ICE candidates (WebRTC unrestricted):', JSON.stringify(iceBefore));
check(
  'WebRTC unrestricted: STUN reveals the non-proxied exit IP (leak exists)',
  leaked.length > 0,
  `${leaked.length} srflx candidate(s)`,
);
// toggle WebRTC off in the extension UI (Settings tab)
await extPage.bringToFront();
await extPage.getByText('Settings', { exact: true }).first().click();
await sleep(500);
await extPage.locator('#webrtc-leak .n-switch').click();
await sleep(1000);
await shot('06-webrtc-toggle-off', extPage);
const policy = await extPage.evaluate(() => chrome.privacy.network.webRTCIPHandlingPolicy.get({}));
check(
  'WebRTC toggle sets webRTCIPHandlingPolicy=disable_non_proxied_udp',
  policy.value === 'disable_non_proxied_udp',
  JSON.stringify(policy),
);
await page.bringToFront();
await page.goto('https://am.i.mullvad.net/');
const iceAfter = await gatherIce();
log('ICE candidates (WebRTC restricted):', JSON.stringify(iceAfter));
const exposes = (c) =>
  c.includes(WG_EXIT) || / typ srflx /.test(c) || (/ typ host /.test(c) && !c.includes('.local'));
check(
  'WebRTC restricted: no candidate exposes an IP',
  !iceAfter.some(exposes),
  `${iceAfter.length} candidate(s)`,
);
await extPage.bringToFront();
await extPage.locator('#webrtc-leak .n-switch').click();
await sleep(800);
const policy2 = await extPage.evaluate(() => chrome.privacy.network.webRTCIPHandlingPolicy.get({}));
check('WebRTC toggle back on restores default policy', policy2.value === 'default', policy2.value);

// --- 8. popup UI: connection check + DNS/WebRTC leak results -------------------------------
await setState({ globalProxy: info(RELAYS.CH), globalProxyDetails: details(RELAYS.CH) });
const popup = await context.newPage();
await popup.setViewportSize({ width: 400, height: 800 });
await popup.goto(`chrome-extension://${extId}/dist/popup/index.html`);
await popup
  .getByText(/Switzerland|Zurich/)
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => {});
await sleep(4000);
await shot('07-popup-global-ch', popup);
const popupText = await popup.locator('body').innerText();
check(
  'popup connection check shows the proxied exit (Switzerland)',
  /Switzerland|Zurich/.test(popupText),
  popupText.split('\n').slice(0, 8).join(' | '),
);

// --- 9. incognito warning ------------------------------------------------------------------
{
  const p = await openPopupTab();
  const incognito = p.locator('#proxy-status-incognito');
  check(
    'popup warns that proxies are not applied in Incognito (no incognito access)',
    await incognito.isVisible(),
    (await incognito.innerText().catch(() => '')).replace(/\s+/g, ' '),
  );
  await shot('09-incognito-warning', p);
  await p.close();
}

// --- 10. invalid rule fails closed ---------------------------------------------------------
await setState({
  hostProxies: { 'ipinfo.io': { ...info(RELAYS.JP), host: `${RELAYS.JP.host}:1080; DIRECT` } },
  hostProxiesDetails: { 'ipinfo.io': details(RELAYS.JP) },
});
{
  const blocked = await isBlocked('https://ipinfo.io/json');
  const st = await getStatus();
  check(
    'enabled rule with an injected/invalid proxy host blocks the site instead of going direct',
    Boolean(blocked) && st.issues.length === 1,
    `${blocked}; issues=${JSON.stringify(st.issues)}`,
  );
  const other = await amI();
  check('other sites unaffected by the invalid rule (direct)', other.ip === WG_EXIT, other.ip);
}

// --- 11. corrupted stored settings block everything, with a reset ---------------------------
await setState({ globalProxy: info(RELAYS.CH), globalProxyDetails: details(RELAYS.CH) });
await extPage.evaluate(() =>
  chrome.storage.local.set({ globalProxyDetails: '{"socksEnabled": tr' }),
);
{
  const st = await waitStatus((s) => Boolean(s.error));
  const blocked = await isBlocked('https://am.i.mullvad.net/json');
  check(
    'corrupted settings: all traffic blocked (fail closed)',
    Boolean(st.error) && Boolean(blocked),
    `${st.error}; ${blocked}`,
  );
  const p = await openPopupTab();
  const err = p.locator('#proxy-status-error');
  check(
    'popup shows the settings error',
    await err.isVisible(),
    (await err.innerText().catch(() => '')).replace(/\s+/g, ' '),
  );
  await shot('10-corrupted-settings-error', p);
  const badgeErr = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('global toolbar badge shows "!"', badgeErr === '!', badgeErr);
  await p.getByText('Reset proxy settings').click();
  const st2 = await waitStatus((s) => !s.error && !s.active);
  const back = await amI();
  check(
    'reset recovers: proxy released, direct exit',
    !st2.error && back.ip === WG_EXIT,
    `${JSON.stringify(st2)} ${back.ip}`,
  );
  await p.close();
}

// --- 12. settings import validation ----------------------------------------------------------
{
  await extPage.bringToFront();
  await extPage.reload();
  await sleep(1500);
  await extPage.getByText('Import/Export', { exact: true }).first().click();
  await sleep(800);
  const before = await extPage.evaluate(() =>
    chrome.storage.local.get(['hostProxies', 'globalProxy']),
  );
  const malformed = {
    excludedHosts: [],
    globalProxy: { type: 'socks', host: '1.2.3.4:1080; DIRECT', port: 1080 },
    globalProxyDetails: { socksEnabled: true },
    hostProxies: {},
    hostProxiesDetails: {},
  };
  await extPage.locator('input[type=file]').setInputFiles({
    name: 'malformed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(malformed)),
  });
  await sleep(1000);
  const msg = await extPage
    .locator('.text-error')
    .first()
    .innerText()
    .catch(() => '');
  const importVisible = await extPage
    .getByRole('button', { name: 'Import' })
    .isVisible()
    .catch(() => false);
  const after = await extPage.evaluate(() =>
    chrome.storage.local.get(['hostProxies', 'globalProxy']),
  );
  await shot('11-import-rejected', extPage);
  check(
    'malformed settings import is rejected and nothing is written',
    /Invalid settings file/.test(msg) &&
      !importVisible &&
      JSON.stringify(before) === JSON.stringify(after),
    msg.slice(0, 160),
  );

  const good = {
    excludedHosts: ['IFCONFIG.co'],
    globalProxy: {},
    globalProxyDetails: {},
    hostProxies: { 'IPinfo.io': info(RELAYS.JP) },
    hostProxiesDetails: { 'IPinfo.io': details(RELAYS.JP) },
  };
  await extPage.locator('input[type=file]').setInputFiles({
    name: 'good.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(good)),
  });
  await sleep(800);
  await extPage.getByRole('button', { name: 'Import' }).click();
  await sleep(2000);
  const imported = await getJSON('https://ipinfo.io/json');
  check(
    'valid import (with uppercase hosts) is normalized and applied (ipinfo.io → JP)',
    imported.ip === exitIp.JP,
    `${imported.ip} ${imported.country}`,
  );
  await page.bringToFront();
}

// --- 13. random mode: stable across popup opens (relay list refetch) ------------------------
await setState({ randomProxyMode: true });
{
  const s1 = (await amI()).mullvad_exit_ip_hostname;
  const i1 = (await getJSON('https://api.ipify.org?format=json')).ip;
  for (let i = 0; i < 3; i++) {
    const tp = await openToolbarPopup(sw, page);
    await sleep(3500); // popup refetches the relay list
    await tp.close();
    await sleep(500);
  }
  const s2 = (await amI()).mullvad_exit_ip_hostname;
  const i2 = (await getJSON('https://api.ipify.org?format=json')).ip;
  check(
    'random mode: same relays after opening the popup 3 times',
    s1 === s2 && i1 === i2,
    `am.i ${s1}→${s2}; ipify ${i1}→${i2}`,
  );
}

// --- 14. random mode with no relay list: Mullvad API still reachable, list loads -----------
await extPage.evaluate(() => chrome.storage.local.set({ flatProxiesList: '[]' }));
{
  const st = await waitStatus((s) => s.issues.length > 0);
  const blocked = await isBlocked('https://am.i.mullvad.net/json');
  const apiOk = await page
    .goto('https://api.mullvad.net/network/v1-beta1/socks-proxies')
    .then((res) => res.ok())
    .catch(() => false);
  check(
    'random mode without relay list: traffic blocked but api.mullvad.net reachable',
    Boolean(blocked) && apiOk,
    `${blocked}; api ok=${apiOk}; ${st.issues}`,
  );
  const tp = await openToolbarPopup(sw, page);
  await sleep(4000);
  await shot('12-random-empty-list-popup', tp);
  await tp.close();
  const listLen = JSON.parse(
    (await extPage.evaluate(() => chrome.storage.local.get('flatProxiesList'))).flatProxiesList,
  ).length;
  const st2 = await waitStatus((s) => s.issues.length === 0);
  const r = await amI();
  check(
    'opening the popup loads the relay list and random mode works again',
    listLen > 100 && st2.issues.length === 0 && r.mullvad_server_type === 'SOCKS through WireGuard',
    `${listLen} relays, exit ${r.mullvad_exit_ip_hostname}`,
  );
}

// --- 15. another extension takes over the proxy settings -----------------------------------
await setState({ globalProxy: info(RELAYS.CH), globalProxyDetails: details(RELAYS.CH) });
{
  const browserSession = await (await cdpBrowser()).newBrowserCDPSession();
  const { id: hijackerId } = await browserSession.send('Extensions.loadUnpacked', {
    path: HIJACKER,
  });
  const st = await waitStatus((s) => s.controlLost);
  const hijacked = await amI();
  check(
    'other extension takes over: status controlLost',
    st.controlLost && st.levelOfControl === 'controlled_by_other_extensions',
    JSON.stringify(st),
  );
  check(
    '(traffic indeed follows the other extension: us-nyc relay)',
    hijacked.mullvad_exit_ip_hostname === RELAYS.US.name,
    hijacked.mullvad_exit_ip_hostname,
  );
  const tabBadge = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  check('toolbar badge shows "!" while control is lost', tabBadge === '!', tabBadge);
  const tp = await openToolbarPopup(sw, page);
  await sleep(2500);
  const lost = tp.locator('#proxy-status-control-lost');
  check(
    'popup warns that the proxy settings are controlled by another extension',
    await lost.isVisible(),
    (await lost.innerText().catch(() => '')).replace(/\s+/g, ' '),
  );
  await shot('13-control-lost-popup', tp);
  await tp.close();

  await extPage.evaluate((id) => chrome.management.setEnabled(id, false), hijackerId);
  const st2 = await waitStatus((s) => s.applied && !s.controlLost);
  const back = await amI();
  check(
    'other extension disabled: control regained and PAC re-applied (CH)',
    st2.applied && back.mullvad_exit_ip_hostname === RELAYS.CH.name,
    back.mullvad_exit_ip_hostname,
  );
}

// --- 16. site access revoked ("on click"): proxy keeps working ------------------------------
{
  const removed = await extPage.evaluate(() =>
    chrome.permissions.remove({ origins: ['<all_urls>'] }),
  );
  const has = await extPage.evaluate(() =>
    chrome.permissions.contains({ origins: ['<all_urls>'] }),
  );
  await sleep(1000);
  const r = await amI();
  const st = await getStatus();
  check(
    'site access revoked: global proxy still applied',
    removed && !has && r.mullvad_exit_ip_hostname === RELAYS.CH.name && st.applied,
    `${r.mullvad_exit_ip_hostname}`,
  );
  const p = await openPopupTab();
  await shot('14-site-access-revoked-popup', p);
  const note = await p
    .getByText('Your proxy settings are still applied')
    .isVisible()
    .catch(() => false);
  check('popup explains the proxy is still applied without the permissions', note);
  await p.close();
}

// --- 17. cleanup: removing all rules releases proxy settings ------------------------------------
await setState({});
ps = await proxySettings();
check('removing all rules clears proxy settings', ps.value.mode === 'system', ps.value.mode);
const end = await amI();
check('back to direct WireGuard exit', end.ip === WG_EXIT, end.mullvad_exit_ip_hostname);

fs.writeFileSync(
  `${ART}/results.json`,
  JSON.stringify({ exitIp, wgExit: WG_EXIT, results }, null, 2),
);
const failed = results.filter((r) => !r.ok);
log(`\n${results.length - failed.length}/${results.length} checks passed`);
await context.close();
process.exit(failed.length ? 1 : 0);
