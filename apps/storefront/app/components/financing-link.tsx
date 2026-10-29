import type { ServiceFinancing } from "@booking/shared-types";

import { formatCurrency } from "../lib/storefront-shell";

/**
 * "$250/month for 3 months" as an expandable pill under a service's description. Opening it explains the
 * plan and links to the studio's financing page. Renders nothing when the service has no financing.
 */
export function FinancingLink({ financing, priceCents }: { financing?: ServiceFinancing | null; priceCents: number }) {
  if (!financing) return null;
  return (
    <details className="sf-finance">
      <summary className="sf-finance__pill">
        {financing.aprLabel ? <span className="sf-finance__apr">{financing.aprLabel}</span> : null}
        <strong>{formatCurrency(financing.monthlyCents)}/month</strong>
        <span>for {financing.months} months</span>
      </summary>
      <div className="sf-finance__panel">
        <strong>
          Pay {formatCurrency(priceCents)} over {financing.months} months, about {formatCurrency(financing.monthlyCents)}/month
        </strong>
        {financing.disclosure ? <p>{financing.disclosure}</p> : null}
        <div className="sf-finance__links">
          <a href={financing.linkUrl} target="_blank" rel="noopener noreferrer">{financing.buttonText} ↗</a>
          {financing.termsUrl ? (
            <a href={financing.termsUrl} target="_blank" rel="noopener noreferrer">Financing terms</a>
          ) : null}
        </div>
      </div>
    </details>
  );
}
