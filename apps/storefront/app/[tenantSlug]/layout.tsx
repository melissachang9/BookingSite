import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { storefrontApi, isApiNotFoundError } from "../lib/storefront-api";
import { titleFromSlug } from "../lib/storefront-shell";
import { TenantBackButton } from "./tenant-back-button";

type TenantLayoutProps = {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
};

export default async function TenantLayout({ children, params }: TenantLayoutProps) {
  const { tenantSlug } = await params;
  let tenantName = titleFromSlug(tenantSlug);
  let homepageUrl: string | undefined;

  try {
    const tenant = await storefrontApi.getTenantBySlug(tenantSlug);
    tenantName = tenant.name;
    homepageUrl = tenant.branding.homepageUrl;
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }
  }

  // "Brow Beauty Lab" sets as a bold name followed by the last word in italic serif.
  const nameWords = tenantName.trim().split(/\s+/);
  const lastWord = nameWords.length > 1 ? nameWords[nameWords.length - 1] : null;
  const leadingWords = lastWord ? nameWords.slice(0, -1).join(" ") : tenantName;

  return (
    <div className="tenant-shell">
      <div className="tenant-frame">
        <header className="tenant-header tenant-header--minimal">
          <TenantBackButton ariaLabel={`Back within ${tenantName} booking`} fallbackHref={`/${tenantSlug}`} />

          <Link href={`/${tenantSlug}`} className="tenant-wordmark" aria-label={tenantName}>
            <span className="tenant-wordmark__lead">{leadingWords}</span>
            {lastWord ? <span className="tenant-wordmark__tail"> {lastWord}</span> : null}
          </Link>

          <nav className="tenant-nav tenant-nav--minimal" aria-label="Customer booking routes">
            {homepageUrl ? (
              <a href={homepageUrl} target="_blank" rel="noreferrer">
                Visit website
              </a>
            ) : null}
          </nav>
        </header>

        <div className="tenant-content">{children}</div>
      </div>
    </div>
  );
}
