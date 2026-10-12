import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import { DEFAULT_PROXY_STATUS, ProxyStatus } from '@/helpers/proxyStatus';

let localSet: ReturnType<typeof vi.fn>;

const mountWithStatus = async (status: Partial<ProxyStatus>) => {
  vi.resetModules();
  localSet = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { id: 'ext-id' },
    tabs: { create: vi.fn() },
    storage: {
      onChanged: { addListener: vi.fn() },
      local: {
        get: vi.fn(async () => ({
          proxyStatus: JSON.stringify({ ...DEFAULT_PROXY_STATUS, ...status }),
        })),
        set: localSet,
      },
    },
  });
  const { default: ProxyStatusWarnings } =
    await import('@/components/Proxy/ProxyStatusWarnings.vue');
  const wrapper = mount(ProxyStatusWarnings);
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('ProxyStatusWarnings', () => {
  it('renders nothing when everything is fine', async () => {
    const wrapper = await mountWithStatus({ active: true, applied: true });
    expect(wrapper.find('#proxy-status').exists()).toBe(false);
  });

  it('warns when another extension controls the proxy settings', async () => {
    const wrapper = await mountWithStatus({
      active: true,
      controlLost: true,
      levelOfControl: 'controlled_by_other_extensions',
    });
    expect(wrapper.find('#proxy-status-control-lost').text()).toContain('another extension');
  });

  it('warns about a policy', async () => {
    const wrapper = await mountWithStatus({
      active: true,
      controlLost: true,
      levelOfControl: 'not_controllable',
    });
    expect(wrapper.find('#proxy-status-control-lost').text()).toContain('a policy');
  });

  it('shows settings errors with a reset button', async () => {
    const wrapper = await mountWithStatus({ active: true, error: 'Proxy settings error: x' });
    const error = wrapper.find('#proxy-status-error');
    expect(error.text()).toContain('All traffic is blocked');
    expect(error.text()).toContain('Reset proxy settings');
  });

  it('warns about incognito only when proxies are active', async () => {
    let wrapper = await mountWithStatus({ active: true, applied: true, incognitoAllowed: false });
    expect(wrapper.find('#proxy-status-incognito').exists()).toBe(true);
    wrapper = await mountWithStatus({ active: false, incognitoAllowed: false });
    expect(wrapper.find('#proxy-status-incognito').exists()).toBe(false);
  });

  it('lists rule issues', async () => {
    const wrapper = await mountWithStatus({
      active: true,
      applied: true,
      issues: ['Random mode: the proxy list is not loaded yet, traffic is blocked'],
    });
    expect(wrapper.findAll('.proxy-status-issue')).toHaveLength(1);
  });

  it('reset also clears the cached relay list', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const wrapper = await mountWithStatus({ active: true, error: 'Proxy settings error: x' });
    await wrapper.find('#proxy-status-error button').trigger('click');
    await flushPromises();
    expect(localSet).toHaveBeenCalledWith(expect.objectContaining({ flatProxiesList: '[]' }));
    expect(reload).toHaveBeenCalled();
  });

  it('shows apply errors as "not in effect", without claiming all traffic is blocked', async () => {
    const wrapper = await mountWithStatus({
      active: true,
      controlLost: true,
      applyError: 'Could not apply the proxy settings: not_controllable',
    });
    expect(wrapper.find('#proxy-status-error').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Reset proxy settings');
    expect(wrapper.find('#proxy-status-control-lost').text()).toContain('not_controllable');
  });

  it('shows read errors as blocked + retrying, without offering a reset', async () => {
    const wrapper = await mountWithStatus({
      active: true,
      readError: 'Could not read the proxy settings: IO error',
    });
    expect(wrapper.find('#proxy-status-read-error').text()).toContain('Retrying');
    expect(wrapper.text()).not.toContain('Reset proxy settings');
  });
});
