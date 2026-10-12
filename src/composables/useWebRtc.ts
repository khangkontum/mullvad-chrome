import { computed, ref } from 'vue';

import useStore from '@/composables/useStore';

// Chrome can't disable WebRTC, but with `disable_non_proxied_udp` WebRTC only uses the proxy
// (UDP is never sent through SOCKS), so no local or public IP is exposed via ICE candidates.
export const WEBRTC_BLOCKED_POLICY = 'disable_non_proxied_udp';

// The real browser state (not a stored preference): true = WebRTC unrestricted
const webRTCStatus = ref(true);
const webRTCPolicy = ref('default');
const webRTCLevelOfControl = ref('controllable_by_this_extension');
// Another extension or a policy owns the setting: our switch can't change it
const webRTCControlledElsewhere = computed(
  () =>
    webRTCLevelOfControl.value === 'controlled_by_other_extensions' ||
    webRTCLevelOfControl.value === 'not_controllable',
);

const readWebRTCPolicy = async () => {
  try {
    const { value, levelOfControl } = await chrome.privacy.network.webRTCIPHandlingPolicy.get({});
    webRTCPolicy.value = String(value);
    webRTCLevelOfControl.value = levelOfControl;
    webRTCStatus.value = value !== WEBRTC_BLOCKED_POLICY;
  } catch (e) {
    console.error('Could not read the WebRTC policy', e);
  }
};

const { globalProxyDetails, hostProxiesDetails, randomProxyMode } = useStore();
const proxyConfigured = computed(
  () =>
    !!globalProxyDetails.value?.socksEnabled ||
    randomProxyMode.value === true ||
    Object.values(hostProxiesDetails.value ?? {}).some((d) => d?.socksEnabled),
);

// WebRTC sends UDP directly, bypassing the SOCKS proxy, so with the default policy websites can
// learn the non-proxied IP through STUN. This can't be measured from the extension: Chrome
// doesn't apply webRTCIPHandlingPolicy (nor mDNS host obfuscation) to extension pages, so a
// RTCPeerConnection here always sees every address. Verified on web pages: with
// `disable_non_proxied_udp` they gather no candidates at all. So the leak follows the real policy.
const webRTCLeaking = computed(() => webRTCStatus.value && proxyConfigured.value);

const setWebRTC = async (value: boolean) => {
  if (!webRTCControlledElsewhere.value) {
    try {
      if (value) {
        await chrome.privacy.network.webRTCIPHandlingPolicy.clear({});
      } else {
        await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: WEBRTC_BLOCKED_POLICY });
      }
    } catch (e) {
      console.error('Could not change the WebRTC policy', e);
    }
  }
  // reflect what actually happened
  await readWebRTCPolicy();
};

const useWebRtc = () => {
  void readWebRTCPolicy();

  return {
    readWebRTCPolicy,
    setWebRTC,
    webRTCControlledElsewhere,
    webRTCLeaking,
    webRTCLevelOfControl,
    webRTCPolicy,
    webRTCStatus,
  };
};

export default useWebRtc;
