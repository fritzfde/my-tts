'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ControlRoomRuntime } from '@/components/control-room/control-room-runtime';
import { migrationStatus, navigationGroups, shellRules } from '@/lib/control-room';

type ControlRoomShellProps = {
  children: ReactNode;
};

function isActive(pathname: string, href: string) {
  if (href === '/live') {
    return pathname === '/live';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ControlRoomShell({ children }: ControlRoomShellProps) {
  const pathname = usePathname();

  return (
    <div className="control-room-shell">
      <aside className="control-room-sidebar">
        <div className="control-room-brand">
          <p className="control-room-kicker">React / Next Migration</p>
          <h1>My TTS Control Room</h1>
          <p>
            We are converting the dashboard into route-based tools so each area can load, evolve, and be tested
            independently.
          </p>
        </div>

        <nav className="control-room-nav" aria-label="Primary navigation">
          {navigationGroups.map((group) => (
            <section key={group.title} className="control-room-nav-group">
              <h2>{group.title}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={isActive(pathname, item.href) ? 'control-room-link active' : 'control-room-link'}
                    >
                      <span>{item.label}</span>
                      <small>{item.href}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <section className="control-room-rules" aria-label="Migration rules">
          <h2>Guardrails</h2>
          <ul>
            {shellRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
      </aside>

      <div className="control-room-main-column">
        <header className="control-room-header">
          <div>
            <p className="control-room-kicker">Dedicated branch</p>
            <strong>codex/react-next-phase-1</strong>
          </div>
          <div className="control-room-status-grid" aria-label="Runtime status">
            {migrationStatus.map((item) => (
              <article key={item.label} className="control-room-status-card">
                <span>{item.label}</span>
                <strong>{item.command}</strong>
                <small>{item.detail}</small>
              </article>
            ))}
          </div>
        </header>

        <main className="control-room-content">{children}</main>
        <ControlRoomRuntime />
      </div>
    </div>
  );
}
