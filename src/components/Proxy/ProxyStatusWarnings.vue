<script lang="ts" setup>
import { computed } from 'vue';
import { NCard } from 'naive-ui';

import Button from '@/components/Buttons/Button.vue';
import IconLabel from '@/components/IconLabel.vue';

import useProxyStatus from '@/composables/useProxyStatus';

const { proxyStatus, resetProxySettings, openExtensionSettings } = useProxyStatus();

const controlledBy = computed(() =>
  proxyStatus.value.levelOfControl === 'not_controllable' ? 'a policy' : 'another extension',
);
const showIncognito = computed(
  () => proxyStatus.value.active && !proxyStatus.value.incognitoAllowed && !proxyStatus.value.error,
);
const hasWarnings = computed(
  () =>
    Boolean(proxyStatus.value.error) ||
    proxyStatus.value.controlLost ||
    showIncognito.value ||
    proxyStatus.value.issues.length > 0,
);
</script>

<template>
  <n-card v-if="hasWarnings" id="proxy-status" :bordered="false" class="mb-2">
    <div v-if="proxyStatus.error" id="proxy-status-error" class="mb-2">
      <IconLabel type="leak">
        <strong>All traffic is blocked.</strong> {{ proxyStatus.error }}
      </IconLabel>
      <Button size="small" color="error" class="mt-2" @click="resetProxySettings">
        Reset proxy settings
      </Button>
    </div>

    <div v-else-if="proxyStatus.controlLost" id="proxy-status-control-lost" class="mb-2">
      <IconLabel type="leak">
        <strong>Your Mullvad proxy settings are not in effect.</strong> Chrome's proxy settings are
        controlled by {{ controlledBy }}. Disable it to use the proxies configured here.
      </IconLabel>
    </div>

    <div v-if="showIncognito" id="proxy-status-incognito" class="mb-2">
      <IconLabel type="warning">
        Proxies are <strong>not applied in Incognito windows</strong> unless the extension is
        allowed in Incognito.
      </IconLabel>
      <Button size="small" class="mt-2" @click="openExtensionSettings">
        Open extension settings
      </Button>
    </div>

    <div v-for="issue in proxyStatus.issues" :key="issue" class="proxy-status-issue mb-1">
      <IconLabel type="warning" :text="issue" />
    </div>
  </n-card>
</template>
