const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

const storefrontPrinciples = [
  {
    title: "Booking flow",
    value: "Service, provider, forms, payment, and confirmation will be API-driven.",
  },
  {
    title: "Rendering",
    value: "Next.js App Router remains the SEO and customer-facing shell.",
  },
  {
    title: "API base",
    value: apiBaseUrl,
  },
];


export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Customer storefront</p>
        <h1>Booking Platform v1 starts from a clean public booking surface.</h1>
        <p className="hero-copy">
          This Next.js shell is the new public entry point for booking, forms, and
          payment. The legacy app stays untouched while the new API-driven storefront
          is built in parallel.
        </p>
        <div className="hero-grid">
          {storefrontPrinciples.map((item) => (
            <article className="hero-card" key={item.title}>
              <h2>{item.title}</h2>
              <p>{item.value}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}