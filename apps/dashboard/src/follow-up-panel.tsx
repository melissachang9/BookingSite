import { useEffect, useMemo, useState } from "react";
import type {
  AuthenticatedUser,
  CustomerBookingAttempt,
  CustomerBookingAttemptListResponse,
  BookingAttemptDismissReason,
  DismissBookingAttemptRequest,
  MarkBookingAttemptFollowedUpRequest,
} from "@booking/shared-types";

export type FollowUpApi = {
  listBookingAttempts: (
    tenantSlug: string,
    options?: { includeFollowedUp?: boolean },
  ) => Promise<CustomerBookingAttemptListResponse>;
  markBookingAttemptFollowedUp: (
    tenantSlug: string,
    bookingDraftId: string,
    body?: MarkBookingAttemptFollowedUpRequest,
  ) => Promise<CustomerBookingAttempt>;
  dismissBookingAttempt: (
    tenantSlug: string,
    bookingDraftId: string,
    body: DismissBookingAttemptRequest,
  ) => Promise<CustomerBookingAttempt>;
};

export const DISMISS_REASONS: Array<[BookingAttemptDismissReason, string]> = [
  ["not_interested", "Not interested"],
  ["booked_another_way", "Booked another way"],
  ["duplicate", "Duplicate"],
  ["wrong_contact", "Wrong contact info"],
  ["other", "Other"],
];

export function dismissReasonLabel(reason: string | null | undefined): string {
  return DISMISS_REASONS.find(([key]) => key === reason)?.[1] ?? "Removed";
}

type OutcomeFilter = "all" | "financing_started" | "abandoned";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatWhen(value: string): string {
  return dateTimeFormatter.format(new Date(value));
}

/**
 * Clients who started booking online but never finished: the warmer ones who opened the studio's
 * financing page first, then the ones who left checkout. Applying for financing happens off-site, so
 * "opened financing" only means they clicked through, not that they applied or were approved.
 */
function FollowUpList({
  items,
  canManage,
  onMarkFollowedUp,
  onDismiss,
}: {
  items: CustomerBookingAttempt[];
  canManage: boolean;
  onMarkFollowedUp: (attempt: CustomerBookingAttempt, note: string) => Promise<void>;
  onDismiss: (attempt: CustomerBookingAttempt, reason: BookingAttemptDismissReason, note: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [openForm, setOpenForm] = useState<{ id: string; kind: "follow_up" | "remove" } | null>(null);
  const [reason, setReason] = useState<BookingAttemptDismissReason>("not_interested");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = items.filter((item) => item.followUpAt == null && item.dismissedAt == null);
  const counts = {
    all: open.length,
    financing_started: open.filter((item) => item.outcome === "financing_started").length,
    abandoned: open.filter((item) => item.outcome === "abandoned").length,
  };
  // Followed-up and removed clients leave the list; the record stays on their profile.
  const visible = useMemo(
    () => open.filter((item) => filter === "all" || item.outcome === filter),
    [open, filter],
  );

  const submit = async (attempt: CustomerBookingAttempt, kind: "follow_up" | "remove") => {
    if (kind === "remove" && reason === "other" && note.trim() === "") {
      setError("Add a note explaining why you're removing this client.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (kind === "remove") {
        await onDismiss(attempt, reason, note);
      } else {
        await onMarkFollowedUp(attempt, note);
      }
      setOpenForm(null);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update this client.");
    } finally {
      setSaving(false);
    }
  };

  const openFormFor = (id: string, kind: "follow_up" | "remove") => {
    setOpenForm({ id, kind });
    setNote("");
    setReason("not_interested");
    setError(null);
  };

  return (
    <div className="cs-followup">
      <div className="cs-followup__filters" role="group" aria-label="Filter follow-ups">
        {(
          [
            ["all", "All"],
            ["financing_started", "Opened financing"],
            ["abandoned", "Abandoned"],
          ] as [OutcomeFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`cs-followup__chip${filter === key ? " is-active" : ""}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label} · {counts[key]}
          </button>
        ))}
      </div>

      {error ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {error}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="cs-empty">
          {open.length === 0 ? "Nobody is waiting for a follow-up." : "No one matches this filter."}
        </p>
      ) : (
        <ul className="cs-followup__list">
          {visible.map((attempt) => {
            const warm = attempt.outcome === "financing_started";
            return (
              <li key={attempt.id} className="cs-followup__item">
                <div className="cs-followup__main">
                  <div className="cs-followup__who">
                    {attempt.customerId ? (
                      <a className="cs-followup__name" href={`/customers?customerId=${attempt.customerId}`}>
                        {attempt.customerName ?? "Client"}
                      </a>
                    ) : (
                      <strong>{attempt.customerName ?? "Client"}</strong>
                    )}
                    <span
                      className={`cs-followup__tag ${warm ? "cs-followup__tag--warm" : "cs-followup__tag--cold"}`}
                    >
                      {warm ? "Opened financing" : "Abandoned"}
                    </span>
                  </div>
                  <span className="cs-followup__contact">
                    {[attempt.customerPhone, attempt.customerEmail].filter(Boolean).join(" · ") || "No contact details"}
                  </span>
                  <span className="cs-followup__detail">
                    {attempt.serviceName} with {attempt.providerName} · wanted {formatWhen(attempt.startsAt)}
                    {warm && attempt.financingStartedAt
                      ? ` · opened financing ${formatWhen(attempt.financingStartedAt)}`
                      : ` · left ${formatWhen(attempt.createdAt)}`}
                  </span>
                </div>
                {canManage ? (
                  openForm?.id === attempt.id ? (
                    <form
                      className="cs-followup__form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(attempt, openForm.kind);
                      }}
                    >
                      {openForm.kind === "remove" ? (
                        <select
                          value={reason}
                          aria-label={`Reason for removing ${attempt.customerName ?? "client"}`}
                          onChange={(event) => setReason(event.target.value as BookingAttemptDismissReason)}
                        >
                          {DISMISS_REASONS.map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <input
                        type="text"
                        value={note}
                        maxLength={500}
                        placeholder={
                          openForm.kind === "remove"
                            ? reason === "other"
                              ? "Why? (required)"
                              : "Note (optional)"
                            : "What happened? (optional)"
                        }
                        aria-label={`${openForm.kind === "remove" ? "Removal" : "Follow-up"} note for ${attempt.customerName ?? "client"}`}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <button type="submit" className="cs-followup__action" disabled={saving}>
                        {saving ? "Saving…" : openForm.kind === "remove" ? "Remove" : "Save"}
                      </button>
                      <button type="button" className="cs-followup__link" onClick={() => setOpenForm(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="cs-followup__actions">
                      <button type="button" className="cs-followup__action" onClick={() => openFormFor(attempt.id, "follow_up")}>
                        Mark followed up
                      </button>
                      <button type="button" className="cs-followup__link" onClick={() => openFormFor(attempt.id, "remove")}>
                        Remove from list
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

/** Payments -> Follow-up: clients who opened financing or left checkout without booking. */
export function FollowUpPanel({
  currentUser,
  api,
  tenantSlug,
}: {
  currentUser: AuthenticatedUser | null;
  api: FollowUpApi;
  tenantSlug: string;
}) {
  const canView = currentUser !== null && hasPermission(currentUser, "customers.view");
  const canManage = currentUser !== null && hasPermission(currentUser, "customers.manage");
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; items: CustomerBookingAttempt[] } | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    api
      .listBookingAttempts(tenantSlug, { includeFollowedUp: true })
      .then((response) => {
        if (!cancelled) setState({ kind: "ready", items: response.items });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load clients to follow up with.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug, canView]);

  const dismiss = async (attempt: CustomerBookingAttempt, reason: BookingAttemptDismissReason, note: string) => {
    const updated = await api.dismissBookingAttempt(tenantSlug, attempt.id, { reason, note: note.trim() || null });
    replaceAttempt(updated);
  };

  const replaceAttempt = (updated: CustomerBookingAttempt) =>
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", items: current.items.map((item) => (item.id === updated.id ? updated : item)) }
        : current,
    );

  const markFollowedUp = async (attempt: CustomerBookingAttempt, note: string) => {
    const updated = await api.markBookingAttemptFollowedUp(tenantSlug, attempt.id, { note: note.trim() || null });
    replaceAttempt(updated);
  };

  return (
    <section className="cs-panel-card cs-followup-panel" aria-label="Follow up">
      <div className="cs-panel-title-row">
        <div>
          <p className="cs-eyebrow">Follow-up</p>
          <h4>Clients who didn't finish booking</h4>
        </div>
        {state.kind === "ready" ? (
          <span className="cs-status-chip cs-status-chip--progress">
            {state.items.filter((item) => item.followUpAt == null && item.dismissedAt == null).length} to follow up
          </span>
        ) : null}
      </div>
      <p className="cs-fieldset-help">
        Clients who opened financing are warmer leads. We only know they clicked through to the financing page, not that they applied.
      </p>
      {!canView ? (
        <div className="cs-empty cs-empty--muted">Your role can view payments, but it cannot view clients to follow up with.</div>
      ) : state.kind === "loading" ? (
        <div className="cs-empty">Loading follow-ups...</div>
      ) : state.kind === "error" ? (
        <div className="cs-empty cs-empty--muted">{state.message}</div>
      ) : (
        <FollowUpList items={state.items} canManage={canManage} onMarkFollowedUp={markFollowedUp} onDismiss={dismiss} />
      )}
    </section>
  );
}
