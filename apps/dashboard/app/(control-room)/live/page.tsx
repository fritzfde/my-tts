import { FeaturePage } from '@/components/control-room/feature-page';
import { routePlans } from '@/lib/control-room';

export default function LivePage() {
  return <FeaturePage plan={routePlans.live} />;
}
