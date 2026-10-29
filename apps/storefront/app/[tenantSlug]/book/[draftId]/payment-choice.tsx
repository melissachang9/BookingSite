"use client";

import { useId, useState, type ReactNode } from "react";

type FinancingChoice = {
  linkUrl: string;
  buttonText: string;
  termsUrl: string | null;
  aprLabel: string | null;
  disclosure: string | null;
  months: number;
  monthlyLabel: string;
  totalLabel: string;
};

/**
 * "How would you like to pay?" for a booking that has both a deposit and a financing offer.
 * Choosing financing swaps the main button for a link to the studio's financing page; nothing about
 * the booking changes until the client comes back and pays the deposit, so the hold stays as it is.
 */
export function PaymentChoice({
  staticRows,
  dueLabel,
  dueAmount,
  depositTitle,
  depositDetail,
  financing,
  depositCta,
  canStartFinancing,
  disabledLabel,
  note,
}: {
  staticRows: ReactNode;
  dueLabel: string;
  dueAmount: string;
  depositTitle: string;
  depositDetail: string;
  financing: FinancingChoice;
  depositCta: ReactNode;
  canStartFinancing: boolean;
  disabledLabel: string;
  note: string;
}) {
  const [choice, setChoice] = useState<"deposit" | "financing">("deposit");
  const name = useId();
  const financed = choice === "financing";

  return (
    <>
      <dl className="sf-summary__rows">
        {staticRows}
        <div>
          <dt>{financed ? "Financing" : dueLabel}</dt>
          <dd>{financed ? `${financing.monthlyLabel}/month` : dueAmount}</dd>
        </div>
      </dl>

      <fieldset className="sf-paychoice">
        <legend className="sf-paychoice__legend">How would you like to pay?</legend>
        <label className={`sf-payopt${!financed ? " is-selected" : ""}`}>
          <input type="radio" name={name} checked={!financed} onChange={() => setChoice("deposit")} />
          <span className="sf-payopt__radio" aria-hidden="true" />
          <span className="sf-payopt__text">
            <strong>{depositTitle}</strong>
            <small>{depositDetail}</small>
          </span>
        </label>
        <label className={`sf-payopt${financed ? " is-selected" : ""}`}>
          <input type="radio" name={name} checked={financed} onChange={() => setChoice("financing")} />
          <span className="sf-payopt__radio" aria-hidden="true" />
          <span className="sf-payopt__text">
            <strong>
              {financing.monthlyLabel}/month for {financing.months} months
              {financing.aprLabel ? <span className="sf-payopt__apr">{financing.aprLabel}</span> : null}
            </strong>
            <small>{financing.totalLabel} total, arranged on the financing page</small>
          </span>
        </label>
      </fieldset>

      {financed ? (
        <div className="sf-paychoice__panel">
          <strong>
            Pay {financing.totalLabel} over {financing.months} months, about {financing.monthlyLabel}/month
          </strong>
          {financing.disclosure ? <p>{financing.disclosure}</p> : null}
          <div className="sf-paychoice__links">
            <a href={financing.linkUrl} target="_blank" rel="noopener noreferrer">{financing.buttonText} ↗</a>
            {financing.termsUrl ? (
              <a href={financing.termsUrl} target="_blank" rel="noopener noreferrer">Financing terms</a>
            ) : null}
          </div>
        </div>
      ) : null}

      {financed ? (
        canStartFinancing ? (
          <a
            className="sf-btn sf-btn--dark sf-summary__cta"
            href={financing.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue to financing ↗
          </a>
        ) : (
          <button type="button" className="sf-btn sf-btn--dark sf-summary__cta" disabled>
            {disabledLabel}
          </button>
        )
      ) : (
        depositCta
      )}

      <p className="sf-summary__note">
        {financed
          ? "Financing opens in a new tab. Applying doesn't confirm your booking yet, and your time stays held on this page."
          : note}
      </p>
    </>
  );
}
