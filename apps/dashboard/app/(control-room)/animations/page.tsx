import { AnimationsPageClient } from '@/components/animations/animations-page-client';
import { getAnimationConfig, listAnimations } from '@/lib/api/animations';
import { getSettings } from '@/lib/api/settings';
import type { AnimationConfig, AnimationFile } from '@/lib/types/animations';

export const dynamic = 'force-dynamic';

export default async function AnimationsPage() {
  let settingsPayload = { scope: 'local-dev', settings: {} as Record<string, string> };
  let config: AnimationConfig = {
    enabled: true,
    mappings: {},
    globalPosition: 'bottom-left',
    globalScale: 1,
    animationVolume: 100,
    chroma: { greenThreshold: 70, tolerance: 60, spillReduction: 0.5 }
  };
  let animations: AnimationFile[] = [];

  try {
    [settingsPayload, config, animations] = await Promise.all([getSettings(), getAnimationConfig(), listAnimations()]);
  } catch (error) {
    console.warn('Falling back to empty /animations data during dashboard render:', error);
  }

  return (
    <AnimationsPageClient
      initialScope={settingsPayload.scope}
      initialSettings={settingsPayload.settings}
      initialConfig={config}
      initialAnimations={animations}
    />
  );
}
