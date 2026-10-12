// `proxy` is a required permission on Chrome (it can't be optional), so only `tabs` and
// `<all_urls>` are requested. They are needed for the per-tab UI (badge, current site,
// reloading tabs); the proxy settings themselves apply regardless.
export const getProxyPermissions = async () => {
  return await chrome.permissions.contains({
    permissions: ['tabs'],
    origins: ['<all_urls>'],
  });
};

export const requestProxyPermissions = async () => {
  return await chrome.permissions.request({
    permissions: ['tabs'],
    origins: ['<all_urls>'],
  });
};
