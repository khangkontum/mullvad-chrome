import { computed, ref, watch } from 'vue';

import useStore from './useStore';

const { webRTCStatus } = useStore();

const webRTCSupported = ref(true);
const webRTCLeakedIPs = ref([] as string[]);
const webRTCLeaking = computed(() => (webRTCLeakedIPs.value.length > 0 ? true : false));

// Chrome can't disable WebRTC, but with `disable_non_proxied_udp` WebRTC only uses the proxy
// (UDP is never sent through SOCKS), so no local or public IP is exposed via ICE candidates.
const WEBRTC_BLOCKED_POLICY = 'disable_non_proxied_udp';

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
  if (value) {
    await chrome.privacy.network.webRTCIPHandlingPolicy.clear({});
  } else {
    await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: WEBRTC_BLOCKED_POLICY });
  }
  await checkRTCLeaks();
};

watch(webRTCStatus, () => {
  setWebRTC(webRTCStatus.value);
});

const useWebRtc = () => {
  checkRTCLeaks();

  return {
    setWebRTC,
    webRTCLeaking,
    webRTCLeakedIPs,
    webRTCStatus,
  };
};

export default useWebRtc;
