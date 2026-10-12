export const getProxyPermissions = async () => {
  return await chrome.permissions.contains({
    permissions: ['proxy', 'tabs'],
    origins: ['<all_urls>'],
  });
};

export const requestProxyPermissions = async () => {
  return await chrome.permissions.request({
    permissions: ['proxy', 'tabs'],
    origins: ['<all_urls>'],
  });
};
