import Link from "next/link";

const serviceHighlights = [
  "Brow shaping",
  "Lamination",
  "Tinting",
  "Consultation",
];

const appointmentPromises = [
  { label: "Live openings", detail: "Appointments are held while you complete your details." },
  { label: "Required intake", detail: "Consent and prep forms stay connected to the booking." },
  { label: "Deposit-ready", detail: "Service deposits are calculated from studio policy." },
];

const studioSignals = [
  { label: "Booking", detail: "Held openings, polished checkout, and fewer drop-offs." },
  { label: "Visit prep", detail: "Forms and reminders stay attached to the appointment." },
  { label: "Finish", detail: "Private manage links keep changes and follow-up in one place." },
];

export default function HomePage() {
  return (
    <main className="public-home">
      <section className="studio-hero studio-hero--home">
        <div className="studio-hero__copy">
          <p className="store-eyebrow">Brow Beauty Lab</p>
          <h1>Refined booking for modern beauty visits.</h1>
          <p>
            Precision brow appointments with clear pricing, protected availability, and a polished pre-visit experience.
          </p>
          <div className="hero-actions">
            <Link href="/brow-beauty-lab" className="store-button">
              Book appointment
            </Link>
            <Link href="/cancel/demo-token" className="ghost-link ghost-link--light">
              Manage booking
            </Link>
          </div>
        </div>

        <aside className="hero-insight-panel" aria-label="Studio booking highlights">
          <p className="store-eyebrow">Customer journey</p>
          <div className="hero-insight-list">
            {studioSignals.map((item) => (
              <article key={item.label}>
                <span>{item.label}</span>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="policy-strip" aria-label="Booking highlights">
        {appointmentPromises.map((item) => (
          <article key={item.label} className="policy-card">
            <span>{item.label}</span>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="store-section store-section--split">
        <div>
          <p className="store-eyebrow">Signature services</p>
          <h2>Built for repeat visits, clean prep, and calmer day-of arrivals.</h2>
        </div>
        <div className="service-preview-list">
          {serviceHighlights.map((service) => (
            <span key={service}>{service}</span>
          ))}
        </div>
      </section>
    </main>
  );
}
