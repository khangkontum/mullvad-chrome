import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';

let proxyOn = true;

let policy: { value: string; levelOfControl: string };
const webRTCIPHandlingPolicy = {
  get: vi.fn(async () => policy),
  set: vi.fn(async ({ value }: { value: string }) => {
    policy = { value, levelOfControl: 'controlled_by_this_extension' };
  }),
  clear: vi.fn(async () => {
    policy = { value: 'default', levelOfControl: 'controllable_by_this_extension' };
  }),
};

const load = async () => {
  vi.resetModules();
  vi.stubGlobal('chrome', { privacy: { network: { webRTCIPHandlingPolicy } } });
  vi.doMock('@/composables/useStore', () => ({
    default: () => ({
      globalProxyDetails: ref({ socksEnabled: proxyOn }),
      hostProxiesDetails: ref({}),
      randomProxyMode: ref(false),
    }),
  }));
  const { default: useWebRtc } = await import('@/composables/useWebRtc');
  const webRtc = useWebRtc();
  await flushPromises();
  return webRtc;
};

beforeEach(() => {
  vi.clearAllMocks();
  policy = { value: 'default', levelOfControl: 'controllable_by_this_extension' };
  proxyOn = true;
});

describe('useWebRtc', () => {
  it('reflects the real browser policy', async () => {
    policy = { value: 'disable_non_proxied_udp', levelOfControl: 'controlled_by_this_extension' };
    const { webRTCStatus, webRTCControlledElsewhere } = await load();
    expect(webRTCStatus.value).toBe(false);
    expect(webRTCControlledElsewhere.value).toBe(false);
  });

  it('restricts and restores WebRTC', async () => {
    const { setWebRTC, webRTCStatus, webRTCPolicy } = await load();
    expect(webRTCStatus.value).toBe(true);

    await setWebRTC(false);
    expect(webRTCIPHandlingPolicy.set).toHaveBeenCalledWith({ value: 'disable_non_proxied_udp' });
    expect(webRTCStatus.value).toBe(false);

    await setWebRTC(true);
    expect(webRTCIPHandlingPolicy.clear).toHaveBeenCalled();
    expect(webRTCPolicy.value).toBe('default');
    expect(webRTCStatus.value).toBe(true);
  });

  // Chrome ignores the policy in extension pages, so the leak follows the real policy
  it('reports a leak only while WebRTC is unrestricted and a proxy is configured', async () => {
    const { setWebRTC, webRTCLeaking } = await load();
    expect(webRTCLeaking.value).toBe(true);
    await setWebRTC(false);
    expect(webRTCLeaking.value).toBe(false);
    await setWebRTC(true);
    expect(webRTCLeaking.value).toBe(true);
  });

  it('reports no leak without a proxy (WebRTC exposes the same IP as everything else)', async () => {
    proxyOn = false;
    const { webRTCLeaking } = await load();
    expect(webRTCLeaking.value).toBe(false);
  });

  it.each(['controlled_by_other_extensions', 'not_controllable'])(
    'shows the setting as controlled elsewhere (%s) and does not try to change it',
    async (levelOfControl) => {
      policy = { value: 'default', levelOfControl };
      const { setWebRTC, webRTCControlledElsewhere, webRTCStatus } = await load();
      expect(webRTCControlledElsewhere.value).toBe(true);
      await setWebRTC(false);
      expect(webRTCIPHandlingPolicy.set).not.toHaveBeenCalled();
      // the switch keeps showing the real state
      expect(webRTCStatus.value).toBe(true);
    },
  );
});
