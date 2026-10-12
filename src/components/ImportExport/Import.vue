<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NCard, NIcon } from 'naive-ui';

import TitleCategory from '@/components/TitleCategory.vue';

import useStore from '@/composables/useStore';
import FeWarning from '@/components/Icons/FeWarning.vue';
import { validateImportedSettings } from '@/helpers/socksProxy/validateSettings';

const { excludedHosts, globalProxy, globalProxyDetails, hostProxies, hostProxiesDetails } =
  useStore();

const fileInputRef = ref<HTMLInputElement | null>(null);
const message = ref<string>('');
const settings = ref<ReturnType<JSON['parse']>>('');
const importSuccess = ref<boolean>(false);

const loadSettings = async () => {
  const file = fileInputRef.value?.files?.[0];

  if (!file) {
    message.value = 'Please choose a file';
    return;
  }

  if (!file.name.endsWith('.json')) {
    message.value = 'Please choose a .json file';
    return;
  }

  message.value = '';
  importSuccess.value = false;
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    message.value = `Failed to parse json file: ${e}`;
    return;
  }

  const result = validateImportedSettings(parsed);
  if (!result.ok) {
    settings.value = '';
    message.value = `Invalid settings file, nothing was imported: ${result.errors.join('; ')}`;
    return;
  }
  settings.value = result.value;
};

const importSettings = async () => {
  // re-validate: only validated, normalized settings are ever written
  const result = validateImportedSettings(settings.value);
  if (!result.ok) {
    message.value = `Invalid settings file, nothing was imported: ${result.errors.join('; ')}`;
    return;
  }
  try {
    const value = result.value;
    excludedHosts.value = value.excludedHosts;
    globalProxy.value = value.globalProxy as typeof globalProxy.value;
    globalProxyDetails.value = value.globalProxyDetails as typeof globalProxyDetails.value;
    hostProxies.value = value.hostProxies;
    hostProxiesDetails.value = value.hostProxiesDetails;

    importSuccess.value = true;
    settings.value = '';

    // Reset the input field
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  } catch (error) {
    importSuccess.value = false;
    message.value = `Import failed: ${error}`;
  }
};
</script>

<template>
  <TitleCategory title="Import proxy settings" />
  <n-card class="mt-2 mb-8">
    <div>
      <p v-if="message" class="text-error mb-2">{{ message }}</p>
      <input ref="fileInputRef" type="file" required @change="loadSettings()" />
    </div>
    <div v-if="settings" class="settings">
      <p>To be imported:</p>
      <pre>{{ settings }}</pre>
    </div>
    <div v-if="importSuccess" class="mt-4">Successfully imported.</div>
    <div v-else-if="settings" class="mt-4">
      <p class="flex items-center gap-1 mb-4">
        <n-icon><FeWarning class="text-warning" /></n-icon>Importing this file will overwrite your
        current settings.
      </p>
      <n-button secondary medium @click="importSettings()">Import</n-button>
    </div>
  </n-card>
</template>

<style scoped>
.settings {
  margin-block: 1rem;

  pre {
    max-height: 300px;
    overflow: auto;
    font-size: small;
    background-color: var(--dark-blue);
    padding: 0.5rem;
  }
}
</style>
