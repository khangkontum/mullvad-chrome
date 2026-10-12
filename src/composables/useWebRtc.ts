import { computed, ref } from 'vue';

const webRTCSupported = ref(true);
const webRTCLeakedIPs = ref([] as string[]);
const webRTCLeaking = computed(() => (webRTCLeakedIPs.value.length > 0 ? true : false));

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

const checkWebRTC = async () => {
  webRTCSupported.value = typeof RTCPeerConnection !== 'undefined';
};

const checkRTCLeaks = async () => {
  await checkWebRTC();
  // Clear the previous results
  webRTCLeakedIPs.value = [];

  if (webRTCSupported.value) {
    // Start the leak check
    const pc = new RTCPeerConnection();
    const leakedHosts = new Set<string>();
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const host = e.candidate.candidate.split(' ')[4];
        const isObfuscated = !host || host.endsWith('.local');
        if (!isObfuscated) {
          leakedHosts.add(host);
        }
      }
      if (pc.iceGatheringState === 'complete') {
        // end of gathering
        webRTCLeakedIPs.value = [...leakedHosts];
      }
    };

    pc.createOffer({ offerToReceiveAudio: true }).then((offer) => pc.setLocalDescription(offer));
  }
};

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
  await checkRTCLeaks();
};

const useWebRtc = () => {
  void readWebRTCPolicy();
  checkRTCLeaks();

  return {
    readWebRTCPolicy,
    setWebRTC,
    webRTCControlledElsewhere,
    webRTCLeaking,
    webRTCLeakedIPs,
    webRTCLevelOfControl,
    webRTCPolicy,
    webRTCStatus,
  };
};

export default useWebRtc;
