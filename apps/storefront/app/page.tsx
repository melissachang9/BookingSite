import { LegalLinks } from "./lib/legal";

export default function HomePage() {
  return (
    <main className="public-home">
      <section className="store-section">
        <p className="store-eyebrow">Online booking</p>
        <h1>Use the booking link from the business you want to visit.</h1>
        <p>
          Each business has its own booking page. If you were sent here by mistake, go back to the business&apos;s
          website or open the link from your confirmation email to manage an appointment.
        </p>
        <LegalLinks />
      </section>
    </main>
  );
}
