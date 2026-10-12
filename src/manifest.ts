import fs from 'fs-extra';
import type PkgType from '../package.json';
import { r } from '../scripts/utils';

const icons = {
  '16': './assets/icon-16.png',
  '32': './assets/icon-32.png',
  '48': './assets/icon-48.png',
  '128': './assets/icon-128.png',
};

export async function getManifest(): Promise<chrome.runtime.ManifestV3> {
  const pkg = (await fs.readJSON(r('package.json'))) as typeof PkgType;

  return {
    manifest_version: 3,
    name: pkg.displayName || pkg.name,
    version: pkg.version,
    description: pkg.description,
    minimum_chrome_version: '120',
    action: {
      default_icon: icons,
      default_popup: './dist/popup/index.html',
    },
    options_ui: {
      page: './dist/options/index.html',
      open_in_tab: true,
    },
    background: {
      service_worker: './dist/background.js',
      type: 'module',
    },
    icons,
    // `proxy` can't be an optional permission on Chrome. The PAC script is only applied once the
    // user has granted the optional `tabs` + `<all_urls>` permissions (see helpers/permissions.ts).
    permissions: ['management', 'privacy', 'proxy', 'storage'],
    host_permissions: ['*://*.mullvad.net/*'],
    optional_permissions: ['tabs'],
    optional_host_permissions: ['<all_urls>'],
    incognito: 'spanning',
  };
}
