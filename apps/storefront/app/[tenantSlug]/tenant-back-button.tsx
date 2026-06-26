"use client";

import { useRouter } from "next/navigation";

type TenantBackButtonProps = {
  ariaLabel: string;
  fallbackHref: string;
};

export function TenantBackButton({ ariaLabel, fallbackHref }: TenantBackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(fallbackHref);
  };

  return (
    <button type="button" className="tenant-back-link" aria-label={ariaLabel} onClick={handleClick}>
      ←
    </button>
  );
}