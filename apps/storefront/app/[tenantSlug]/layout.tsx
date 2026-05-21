import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { storefrontApi, isApiNotFoundError } from "../lib/storefront-api";
import { titleFromSlug } from "../lib/storefront-shell";

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

  return (
    <div className="tenant-shell">
      <header className="tenant-header tenant-header--minimal">
        <Link href="/" className="tenant-back-link" aria-label="Back to studio directory">
          ←
        </Link>

        <Link href={`/${tenantSlug}`} className="tenant-wordmark">
          {tenantName}
        </Link>

        <nav className="tenant-nav tenant-nav--minimal" aria-label="Customer booking routes">
          <Link href="/cancel/demo-token">Manage booking</Link>
          {homepageUrl ? (
            <a href={homepageUrl} target="_blank" rel="noreferrer">
              Visit website
            </a>
          ) : null}
        </nav>
      </header>

      <div className="tenant-content">{children}</div>
    </div>
  );
}