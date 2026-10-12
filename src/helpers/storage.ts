// Values in chrome.storage.local are JSON strings (written by useBrowserStorageLocal)
export const parseStored = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try {
    return (JSON.parse(value) as T) ?? fallback;
  } catch {
    return fallback;
  }
};
