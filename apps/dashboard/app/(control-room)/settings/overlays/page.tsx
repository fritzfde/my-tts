import { FeaturePage } from '@/components/control-room/feature-page';
import { routePlans } from '@/lib/control-room';

export default function OverlaysPage() {
  return <FeaturePage plan={routePlans.overlays} />;
}
