import type { ReactNode } from "react";
import Link from "next/link";

export const LEGAL_UPDATED = "November 3, 2026";

// Set these at deploy time so the pages name who runs the platform and how to reach them.
export function platformContact(): { name: string | null; email: string | null } {
  return {
    name: process.env.PLATFORM_LEGAL_NAME?.trim() || null,
    email: process.env.PLATFORM_CONTACT_EMAIL?.trim() || null,
  };
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const contact = platformContact();
  return (
    <main className="legal-page">
      <p className="store-eyebrow">
        <Link href="/">Home</Link>
      </p>
      <h1>{title}</h1>
      <p className="legal-updated">Last updated {LEGAL_UPDATED}</p>
      {children}
      {contact.email ? (
        <section>
          <h2>Contact</h2>
          <p>
            Questions about this page: {contact.name ? `${contact.name}, ` : ""}
            <a href={`mailto:${contact.email}`}>{contact.email}</a>.
          </p>
        </section>
      ) : null}
    </main>
  );
}

export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Legal">
      <Link href="/terms">Terms</Link>
      <Link href="/privacy">Privacy</Link>
    </nav>
  );
}
