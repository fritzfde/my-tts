import { FeaturePage } from '@/components/control-room/feature-page';
import { routePlans } from '@/lib/control-room';

export default function AnimationsPage() {
  return <FeaturePage plan={routePlans.animations} />;
}
