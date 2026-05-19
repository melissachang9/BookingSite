import Link from "next/link";

import { promptTimingSteps } from "../../lib/storefront-shell";

type ManageRouteProps = {
  params: Promise<{ token: string }>;
};

export default async function ManageBookingPage({ params }: ManageRouteProps) {
  const { token } = await params;

  return (
    <main className="manage-page page-stack">
      <section className="state-panel state-panel--manage">
        <p className="store-eyebrow">Manage booking</p>
        <h1>Review your appointment link.</h1>
        <p>Manage links keep cancellation policy, refund messaging, and remaining forms in one secure customer surface.</p>
        <span className="panel-badge panel-badge--wide">{token}</span>
      </section>

      <section className="store-section">
        <div className="section-header">
          <div>
            <p className="store-eyebrow">Follow-up</p>
            <h2>Appointment tasks</h2>
          </div>
        </div>

        <div className="requirement-grid">
          {promptTimingSteps.slice(1).map((step) => (
            <article key={step.timing} className="requirement-card">
              <span>{step.timing.replaceAll("_", " ")}</span>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="support-panel">
        <div>
          <p className="store-eyebrow">Need another appointment?</p>
          <h3>Return to online booking.</h3>
        </div>
        <Link href="/brow-beauty-lab" className="ghost-link">
          Book with Brow Beauty Lab
        </Link>
      </section>
    </main>
  );
}
