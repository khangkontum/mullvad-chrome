import type { Recommendation } from '@/composables/useRecommendations/Recommendation.types';
import {
  defaultRecommendations,
  isRecommended,
} from '@/composables/useRecommendations/defaultRecommendations';

// Service-worker side of the recommendations: updates the stored list directly (no Vue).
const updateRecommendation = async (id: string, modification: Partial<Recommendation>) => {
  if (!isRecommended(id)) return;

  const { recommendations } = await chrome.storage.local.get('recommendations');
  let current: Recommendation[] = defaultRecommendations;
  if (typeof recommendations === 'string') {
    try {
      current = JSON.parse(recommendations);
    } catch {
      // keep defaults
    }
  }

  const updated = current.map((rec) => (rec.id === id ? { ...rec, ...modification } : rec));
  await chrome.storage.local.set({ recommendations: JSON.stringify(updated) });
};

type ExtensionInfo = chrome.management.ExtensionInfo;

export const onExtensionInstalled = ({ id }: ExtensionInfo) =>
  updateRecommendation(id, {
    activated: true,
    ctaLabel: undefined,
    enabled: true,
    ignored: false,
    installed: true,
  });

export const onExtensionUninstalled = (id: string) =>
  updateRecommendation(id, {
    activated: false,
    ctaLabel: 'install',
    enabled: false,
    installed: false,
  });

export const onExtensionEnabled = ({ id }: ExtensionInfo) =>
  updateRecommendation(id, { activated: true, ctaLabel: undefined, enabled: true, ignored: false });

export const onExtensionDisabled = ({ id }: ExtensionInfo) =>
  updateRecommendation(id, { activated: false, ctaLabel: 'enable', enabled: false });
