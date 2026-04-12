import type { RoutePlan } from '@/lib/control-room';

type FeaturePageProps = {
  plan: RoutePlan;
};

export function FeaturePage({ plan }: FeaturePageProps) {
  return (
    <section className="feature-page">
      <header className="feature-page-hero">
        <div>
          <p className="feature-page-eyebrow">{plan.eyebrow}</p>
          <h2>{plan.title}</h2>
        </div>
        <span className="feature-page-phase">{plan.phase}</span>
      </header>

      <p className="feature-page-summary">{plan.summary}</p>

      <section className="feature-page-focus-card">
        <span>Current build focus</span>
        <strong>{plan.focus}</strong>
      </section>

      <div className="feature-page-grid">
        <article className="feature-panel">
          <h3>Legacy surface to absorb</h3>
          <ul>
            {plan.legacyModules.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
        </article>

        <article className="feature-panel">
          <h3>Acceptance criteria</h3>
          <ul>
            {plan.acceptanceCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      <article className="feature-panel feature-panel-notes">
        <h3>Notes</h3>
        <ul>
          {plan.notes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}
