import { vi } from 'vitest';

// Mock browser API
global.chrome = {
  runtime: {
    getManifest: vi.fn(() => ({
      version: '0.9.11',
      name: 'Mullvad Browser Extension',
    })),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
  },
} as unknown as typeof chrome;
