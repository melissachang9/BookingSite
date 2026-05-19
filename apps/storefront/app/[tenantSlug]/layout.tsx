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
      <header className="tenant-header">
        <div className="tenant-brand">
          <Link href="/" className="back-link">
            Studio directory
          </Link>
          <div className="brand-lockup">
            <span className="brand-mark">BB</span>
            <div>
              <p className="store-eyebrow">Private booking</p>
              <h1>{tenantName}</h1>
            </div>
          </div>
        </div>

        <nav className="tenant-nav" aria-label="Customer booking routes">
          <Link href={`/${tenantSlug}`}>Services</Link>
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