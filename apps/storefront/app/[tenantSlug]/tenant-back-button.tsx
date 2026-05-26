"use client";

import { useRouter } from "next/navigation";

type TenantBackButtonProps = {
  ariaLabel: string;
  fallbackHref: string;
};

export function TenantBackButton({ ariaLabel, fallbackHref }: TenantBackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (typeof window === "undefined") {
      router.push(fallbackHref);
      return;
    }

    if (document.referrer.length > 0) {
      try {
        if (new URL(document.referrer).origin === window.location.origin) {
          router.back();
          return;
        }
      } catch {
        router.push(fallbackHref);
        return;
      }
    }

    router.push(fallbackHref);
  };

  return (
    <button type="button" className="tenant-back-link" aria-label={ariaLabel} onClick={handleClick}>
      ←
    </button>
  );
}