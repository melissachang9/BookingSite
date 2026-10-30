import type { AuthenticatedUser, TenantSummary } from "@booking/shared-types";

import { ReportsSection } from "./reports-section";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

/** Reports is its own area of the menu; the report tabs themselves live in ReportsSection. */
export function ReportsPage({
  definition,
  currentUser,
  tenant,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
  tenant: TenantSummary | null;
}) {
  return (
    <main className="cs-page-stack" aria-label={definition.title}>
      <ReportsSection
        tenantSlug={currentUser.tenantSlug}
        tenantTimezone={tenant?.timezone ?? "UTC"}
        canViewReports={hasPermission(currentUser, "reports.view")}
        canViewFinancial={hasPermission(currentUser, "reports.financial")}
        canExport={hasPermission(currentUser, "reports.export")}
        canManageMarketing={hasPermission(currentUser, "settings.manage")}
      />
    </main>
  );
}
