import type { ReactElement } from "react";

type ContactIconKind = "phone" | "email" | "address" | "birthday";

export function formatCustomerAddress(customer: {
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
}): string {
  const cityLine = [customer.addressCity, customer.addressState, customer.addressZip]
    .filter(Boolean)
    .join(" ");
  return [customer.addressStreet, cityLine].filter(Boolean).join(", ");
}

export function memberMonthsSince(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.max(
    1,
    (now.getFullYear() - created.getFullYear()) * 12 +
      (now.getMonth() - created.getMonth()),
  );
}

export function ContactIcon({ kind }: { kind: ContactIconKind }): ReactElement {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "cs-contact-icon",
  };
  if (kind === "phone") {
    return (
      <svg {...common}>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </svg>
    );
  }
  if (kind === "email") {
    return (
      <svg {...common}>
        <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
        <path d="m4 7.5 8 6 8-6" />
      </svg>
    );
  }
  if (kind === "birthday") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

export type ContactRow = { kind: ContactIconKind; label: string; value: string };

/** Formats an ISO date (YYYY-MM-DD) as "14 March 1991" without timezone shifts. */
export function formatBirthday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
  return `${day} ${monthName} ${year}`;
}

type ContactSource = {
  phone?: string | null;
  email?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressZip?: string | null;
  birthday?: string | null;
};

/** Always returns every row; `value` is empty when nothing is on file. */
export function buildContactRows(
  customer: ContactSource,
  options: { includeBirthday?: boolean } = {},
): ContactRow[] {
  const rows: ContactRow[] = [
    { kind: "phone", label: "Mobile", value: customer.phone ?? "" },
    { kind: "email", label: "Email", value: customer.email ?? "" },
    { kind: "address", label: "Address", value: formatCustomerAddress(customer) },
  ];
  if (options.includeBirthday) {
    rows.push({
      kind: "birthday",
      label: "Birthday",
      value: customer.birthday ? formatBirthday(customer.birthday) : "",
    });
  }
  return rows;
}
