const migrationSteps = [
  {
    title: '1. App Shell',
    description: 'Bring the current dashboard structure into a typed Next.js app without changing behavior.'
  },
  {
    title: '2. Shared State',
    description: 'Introduce a client store for live chat, online users, sound alerts, animations, and settings.'
  },
  {
    title: '3. Screen-by-Screen Migration',
    description: 'Move legacy UI modules into React components, preserving the current feature set under test.'
  },
  {
    title: '4. API Boundary',
    description: 'Replace direct legacy fetch assumptions with typed contracts for the future FastAPI-backed services.'
  }
];

export default function DashboardMigrationHome() {
  return (
    <main className="migration-shell">
      <section className="migration-hero">
        <p className="migration-eyebrow">React / Next Migration</p>
        <h1>New frontend workspace is ready.</h1>
        <p className="migration-lead">
          This app runs alongside the legacy dashboard. The migration stays incremental: keep the old app working on
          port 3000, build the new UI on port 3001, and move features over under test coverage.
        </p>
      </section>

      <section className="migration-card-grid" aria-label="Migration steps">
        {migrationSteps.map((step) => (
          <article key={step.title} className="migration-card">
            <h2>{step.title}</h2>
            <p>{step.description}</p>
          </article>
        ))}
      </section>

      <section className="migration-status">
        <div className="migration-status-block">
          <span className="migration-status-label">Legacy app</span>
          <strong>`npm run start:web`</strong>
          <span>Current Express dashboard on port 3000</span>
        </div>
        <div className="migration-status-block">
          <span className="migration-status-label">New app</span>
          <strong>`npm run start:dashboard`</strong>
          <span>Next.js migration workspace on port 3001</span>
        </div>
      </section>
    </main>
  );
}
