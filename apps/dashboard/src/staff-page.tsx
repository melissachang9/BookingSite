import { useEffect, useMemo, useState } from "react";
import type {
  AuthenticatedUser,
  CreateTenantUserRequest,
  TenantUserSummary,
  UpdateTenantUserRequest,
} from "@booking/shared-types";

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

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; user: TenantUserSummary }
  | { kind: "password"; user: TenantUserSummary };

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  provider: "Provider",
};

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "staff", label: "Staff" },
  { value: "provider", label: "Provider" },
];

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export function StaffPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
}) {
  const canManage = hasPermission(currentUser, "settings.manage");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setState({ kind: "loading" });
    platformApi
      .listTenantUsers(currentUser.tenantSlug)
      .then((response) => {
        if (cancelled) return;
        setState({ kind: "ready", users: response.users });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: readErrorMessage(error, "Unable to load team roster.") });
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, currentUser.tenantSlug, refreshKey]);

  const handleSaved = () => {
    setModal({ kind: "none" });
    setRefreshKey((value) => value + 1);
  };

  if (!canManage) {
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
          <div>
            <p className="eyebrow">Team roster</p>
            <h4>Dashboard users</h4>
            <p className="settings-form-help">
              Add owners, managers, staff, and providers who can sign in to the dashboard.
            </p>
          </div>
          <button
            type="button"
            className="primary-action"
            onClick={() => setModal({ kind: "add" })}
          >
            Add user
          </button>
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
                <th aria-label="Actions" />
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
                  <td className="staff-roster-actions">
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => setModal({ kind: "edit", user })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-action"
                      onClick={() => setModal({ kind: "password", user })}
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {modal.kind === "add" ? (
        <AddUserModal
          tenantSlug={currentUser.tenantSlug}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
      {modal.kind === "edit" ? (
        <EditUserModal
          tenantSlug={currentUser.tenantSlug}
          user={modal.user}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
      {modal.kind === "password" ? (
        <ResetPasswordModal
          tenantSlug={currentUser.tenantSlug}
          user={modal.user}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
    </main>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel">
        <header className="modal-header">
          <h4>{title}</h4>
          <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function AddUserModal({
  tenantSlug,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateTenantUserRequest>({
    email: "",
    name: "",
    role: "staff",
    initialPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = useMemo(
    () => submitting || !form.email.trim() || !form.name.trim() || form.initialPassword.length < 8,
    [form, submitting],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.createTenantUser(tenantSlug, {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        initialPassword: form.initialPassword,
      });
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to create user."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Add user" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Initial password</span>
          <input
            type="text"
            value={form.initialPassword}
            onChange={(event) => setForm({ ...form, initialPassword: event.target.value })}
            minLength={8}
            required
          />
          <small className="settings-form-help">
            Minimum 8 characters. Share securely with the new user.
          </small>
        </label>
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={disabled}>
            {submitting ? "Saving…" : "Create user"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditUserModal({
  tenantSlug,
  user,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{ name: string; role: string; isActive: boolean }>({
    name: user.name,
    role: user.role,
    isActive: user.isActive,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: UpdateTenantUserRequest = {};
    if (form.name.trim() !== user.name) payload.name = form.name.trim();
    if (form.role !== user.role) payload.role = form.role;
    if (form.isActive !== user.isActive) payload.isActive = form.isActive;
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    try {
      await platformApi.updateTenantUser(tenantSlug, user.id, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to update user."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Edit ${user.name}`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input type="email" value={user.email} disabled readOnly />
          <small className="settings-form-help">Email cannot be changed in this release.</small>
        </label>
        <label>
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          <span>Active</span>
        </label>
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={submitting}>
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ResetPasswordModal({
  tenantSlug,
  user,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.resetTenantUserPassword(tenantSlug, user.id, { newPassword: password });
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to reset password."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Reset password for ${user.name}`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          <small className="settings-form-help">Minimum 8 characters. Share securely with the user.</small>
        </label>
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-action"
            disabled={submitting || password.length < 8}
          >
            {submitting ? "Saving…" : "Save new password"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
