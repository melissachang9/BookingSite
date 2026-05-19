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

export default function HomePage() {
  return (
    <main className="public-home">
      <section className="studio-hero studio-hero--home">
        <div className="studio-hero__copy">
          <p className="store-eyebrow">Luxury beauty studio</p>
          <h1>Brow Beauty Lab</h1>
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
          <h2>Built for repeat visits, clean prep, and fewer day-of surprises.</h2>
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
