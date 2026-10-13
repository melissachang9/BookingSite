"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";

import { CloverCardForm, type CloverCardConfig } from "./clover-card-form";
import { chargeBalanceCardAction, chargeDepositCardAction } from "./card-actions";

type Props = {
  config: CloverCardConfig;
  submitLabel: string;
  target:
    | { kind: "deposit"; tenantSlug: string; bookingDraftId: string; sessionId: string }
    | { kind: "balance"; token: string; sessionId: string };
};

/** Mounts the Clover card form and turns a failed charge into a message (and an unknown outcome into a safe retry). */
export function CardPayment({ config, submitLabel, target }: Props): ReactElement {
  const router = useRouter();
  return (
    <CloverCardForm
      config={config}
      submitLabel={submitLabel}
      onSubmit={async (token, attemptId) => {
        const result =
          target.kind === "deposit"
            ? await chargeDepositCardAction({ ...target, sourceToken: token, attemptId })
            : await chargeBalanceCardAction({ ...target, sourceToken: token, attemptId });
        if (!result.ok) {
          const error = new Error(result.message) as Error & { payload?: { error: { code: string } } };
          error.payload = { error: { code: result.code } };
          throw error;
        }
        router.push(result.redirectTo);
        // Keep the button busy until navigation lands, so a second tap can't re-submit.
        await new Promise(() => undefined);
      }}
    />
  );
}
