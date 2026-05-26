"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingSubmitButtonProps = {
  label: ReactNode;
  pendingLabel: ReactNode;
  className?: string;
};

export function PendingSubmitButton({ label, pendingLabel, className }: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      data-pending={pending ? "true" : "false"}
    >
      <span aria-live="polite">{pending ? pendingLabel : label}</span>
    </button>
  );
}