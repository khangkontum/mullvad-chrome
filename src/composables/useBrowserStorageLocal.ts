import { useStorageAsync, StorageLikeAsync } from '@vueuse/core';

const browserStorageLocal: StorageLikeAsync = {
  removeItem(key: string) {
    return chrome.storage.local.remove(key);
  },

  setItem(key: string, value: string) {
    return chrome.storage.local.set({ [key]: value });
  },

  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as string) ?? null;
  },
};

const useBrowserStorageLocal = <T>(key: string, initialValue: T) => {
  return useStorageAsync(key, initialValue, browserStorageLocal);
};

export default useBrowserStorageLocal;
