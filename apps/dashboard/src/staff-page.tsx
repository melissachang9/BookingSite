import { useEffect, useState } from "react";
import type { AuthenticatedUser, TenantUserSummary } from "@booking/shared-types";

import { platformApi } from "./platform-api";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; users: TenantUserSummary[] }
  | { kind: "error"; message: string };

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  provider: "Provider",
};

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function StaffPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
}) {
  const canViewRoster = hasPermission(currentUser, "settings.manage");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!canViewRoster) return;
    let cancelled = false;
    platformApi
      .listTenantUsers(currentUser.tenantSlug)
      .then((response) => {
        if (cancelled) return;
        setState({ kind: "ready", users: response.users });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to load team roster.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [canViewRoster, currentUser.tenantSlug]);

  if (!canViewRoster) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>You do not have permission to view the team roster.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>{definition.title}</h3>
          <p>{definition.description}</p>
        </div>
      </section>

      <section className="ops-panel staff-roster-panel">
        <header className="staff-roster-header">
          <p className="eyebrow">Team roster</p>
          <h4>Dashboard users</h4>
          <p className="settings-form-help">
            Read-only view of users with sign-in access to this dashboard. Inviting and editing
            teammates ships in a later release.
          </p>
        </header>

        {state.kind === "loading" ? <p>Loading roster…</p> : null}
        {state.kind === "error" ? (
          <p role="alert" className="settings-error">
            {state.message}
          </p>
        ) : null}
        {state.kind === "ready" && state.users.length === 0 ? (
          <p>No users are configured yet.</p>
        ) : null}
        {state.kind === "ready" && state.users.length > 0 ? (
          <table className="settings-table staff-roster-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td>{ROLE_LABELS[user.role] ?? user.role}</td>
                  <td>{user.isActive ? "Active" : "Inactive"}</td>
                  <td>{DATE_FORMAT.format(new Date(user.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
