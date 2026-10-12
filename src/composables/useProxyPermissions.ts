import { ref, readonly, onUnmounted } from 'vue';
import { getProxyPermissions, requestProxyPermissions } from '@/helpers/permissions';

const isGranted = ref(false);

const checkProxyPermissions = async () => {
  isGranted.value = await getProxyPermissions();
};

const requestPermissions = async (): Promise<boolean> => {
  isGranted.value = await requestProxyPermissions();
  return isGranted.value;
};

// On module load so every context (popup, options) starts with the correct state.
void checkProxyPermissions();

const useProxyPermissions = () => {
  // Keep the permission state in sync if permissions are granted or revoked
  // from any context (e.g. the browser's permission management UI).
  const syncPermissionState = () => void checkProxyPermissions();

  chrome.permissions.onAdded.addListener(syncPermissionState);
  chrome.permissions.onRemoved.addListener(syncPermissionState);

  onUnmounted(() => {
    chrome.permissions.onAdded.removeListener(syncPermissionState);
    chrome.permissions.onRemoved.removeListener(syncPermissionState);
  });

  return {
    isGranted: readonly(isGranted),
    checkProxyPermissions,
    requestPermissions,
  };
};

export default useProxyPermissions;
