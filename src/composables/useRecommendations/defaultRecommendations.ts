import { Recommendation } from './Recommendation.types';

// Chrome Web Store ID of uBlock Origin Lite
export const UBOL_ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh';

export const defaultExtensions: Recommendation[] = [
  {
    type: 'extension',
    id: UBOL_ID,
    name: 'Install uBlock Origin Lite',
    description: `uBlock Origin Lite is a free and open-source, permission-less content blocker built for Manifest V3, consuming minimal resources.`,
    homeUrl: 'https://github.com/uBlockOrigin/uBOL-home',
    icon: 'ubo64.png',
    enabled: false,
    installed: false,
    activated: false,
    ignored: false,
    ctaLabel: 'install',
    ctaUrl: `https://chromewebstore.google.com/detail/ublock-origin-lite/${UBOL_ID}`,
  },
];

export const defaultRecommendations = [...defaultExtensions];

export const isRecommended = (id: string) => {
  return defaultRecommendationsIds.includes(id);
};

export const defaultRecommendationsIds = defaultRecommendations.map((rec) => rec.id);
