// `proxy` is a required permission on Chrome (it can't be optional), so only `tabs` and
// `<all_urls>` are requested. The PAC script is only applied once these are granted.
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
