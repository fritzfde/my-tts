import type { ReactNode } from 'react';
import { ControlRoomShell } from '@/components/control-room/control-room-shell';

type ControlRoomLayoutProps = {
  children: ReactNode;
};

export default function ControlRoomLayout({ children }: ControlRoomLayoutProps) {
  return <ControlRoomShell>{children}</ControlRoomShell>;
}
