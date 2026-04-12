import { FeaturePage } from '@/components/control-room/feature-page';
import { routePlans } from '@/lib/control-room';

export default function IntegrationsPage() {
  return <FeaturePage plan={routePlans.integrations} />;
}
