export enum Tab {
  SETTINGS = 'settings',
  PROXY = 'proxy',
  ABOUT = 'about',
}

export const { version } = chrome.runtime.getManifest();

export const openPopup = () => {
  chrome.action.openPopup();
};
export const closePopup = () => {
  // The delay is added to stop a new empty browser window from opening
  // when installing the extension from the popup
  setTimeout(() => {
    window.close();
  }, 100);
};

export const openOptions = async (tab?: Tab) => {
  if (tab) {
    await chrome.storage.local.set({ optionsActiveTab: tab });
  }
  closePopup();
  chrome.runtime.openOptionsPage();
};

export const isPopupContext = () => {
  const views = chrome.extension.getViews({ type: 'popup' });
  return views.includes(window);
};

const findTabIdByUrl = async (url: string): Promise<number | undefined> => {
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    return tabs[0].id;
  }
  return undefined;
};

export const reloadOptions = async () => {
  // Reload the options page if we're in the popup context
  if (isPopupContext()) {
    const optionsUrl = chrome.runtime.getURL('dist/options/index.html');
    const optionsTabID = await findTabIdByUrl(optionsUrl);

    if (optionsTabID !== undefined) {
      chrome.tabs.reload(optionsTabID);
    }
  }
};
