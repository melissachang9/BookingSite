import type { ServiceFinancing } from "@booking/shared-types";

import { formatCurrency } from "../lib/storefront-shell";

/** "or $100/mo" with the studio's financing button, shown beside a service price. Renders nothing when there is none. */
export function FinancingLink({ financing }: { financing?: ServiceFinancing | null }) {
  if (!financing) return null;
  return (
    <a className="sf-financing" href={financing.linkUrl} target="_blank" rel="noopener noreferrer">
      <span>or {formatCurrency(financing.monthlyCents)}/mo</span>
      <strong>{financing.buttonText}</strong>
    </a>
  );
}
