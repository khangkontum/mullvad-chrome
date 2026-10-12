<script lang="ts" setup>
import IconLabel from '@/components/IconLabel.vue';
import useWebRtc from '@/composables/useWebRtc';

const { webRTCLeaking } = useWebRtc();
</script>

<template>
  <div v-if="webRTCLeaking" class="flex items-center text-lg">
    <IconLabel text="WebRTC can reveal your non-proxied IP" type="leak" />
  </div>
</template>
