import "./styles.css";

const apiBaseUrl =
  import.meta.env.VITE_PUBLIC_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:8000/api/v1";

const priorities = [
  "Calendar-first booking operations",
  "Tenant-safe customer and payment workflows",
  "Unified forms for customer-facing and internal use",
];

export function App() {
  return (
    <main className="dashboard-shell">
      <section className="dashboard-panel">
        <p className="dashboard-eyebrow">Staff dashboard</p>
        <h1>Booking Platform v1</h1>
        <p className="dashboard-copy">
          This shell is the new React and Vite operator workspace. Booking creation,
          checkout, and customer operations will move here as API-driven features.
        </p>
        <dl className="dashboard-meta">
          <div>
            <dt>API base</dt>
            <dd>{apiBaseUrl}</dd>
          </div>
          <div>
            <dt>Stack</dt>
            <dd>React 19, Vite, Vanilla CSS</dd>
          </div>
        </dl>
        <ul className="dashboard-list">
          {priorities.map((priority) => (
            <li key={priority}>{priority}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}