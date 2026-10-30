import { useMemo, useState } from "react";
import type { CustomerBookingAttempt } from "@booking/shared-types";

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
export function ClientFollowUpTab({
  items,
  canManage,
  onOpenClient,
  onMarkFollowedUp,
}: {
  items: CustomerBookingAttempt[];
  canManage: boolean;
  onOpenClient: (customerId: string) => void;
  onMarkFollowedUp: (attempt: CustomerBookingAttempt, note: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [showDone, setShowDone] = useState(false);
  const [openFormId, setOpenFormId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = items.filter((item) => item.followUpAt == null);
  const counts = {
    all: open.length,
    financing_started: open.filter((item) => item.outcome === "financing_started").length,
    abandoned: open.filter((item) => item.outcome === "abandoned").length,
  };
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === "all" || item.outcome === filter) && (showDone ? true : item.followUpAt == null),
      ),
    [items, filter, showDone],
  );

  const submit = async (attempt: CustomerBookingAttempt) => {
    setSaving(true);
    setError(null);
    try {
      await onMarkFollowedUp(attempt, note);
      setOpenFormId(null);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to mark this as followed up.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cs-followup" aria-label="Follow up">
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
        <label className="cs-followup__toggle">
          <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
          Show followed up
        </label>
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
            const done = attempt.followUpAt != null;
            return (
              <li key={attempt.id} className={`cs-followup__item${done ? " is-done" : ""}`}>
                <div className="cs-followup__main">
                  <div className="cs-followup__who">
                    {attempt.customerId ? (
                      <button type="button" className="cs-followup__name" onClick={() => onOpenClient(attempt.customerId as string)}>
                        {attempt.customerName ?? "Client"}
                      </button>
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
                  {done ? (
                    <span className="cs-followup__done">
                      Followed up {formatWhen(attempt.followUpAt as string)}
                      {attempt.followUpByName ? ` by ${attempt.followUpByName}` : ""}
                      {attempt.followUpNote ? `: ${attempt.followUpNote}` : ""}
                    </span>
                  ) : null}
                </div>
                {!done && canManage ? (
                  openFormId === attempt.id ? (
                    <form
                      className="cs-followup__form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(attempt);
                      }}
                    >
                      <input
                        type="text"
                        value={note}
                        maxLength={500}
                        placeholder="What happened? (optional)"
                        aria-label={`Follow-up note for ${attempt.customerName ?? "client"}`}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <button type="submit" className="cs-followup__action" disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="cs-followup__link" onClick={() => setOpenFormId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="cs-followup__action"
                      onClick={() => {
                        setOpenFormId(attempt.id);
                        setNote("");
                        setError(null);
                      }}
                    >
                      Mark followed up
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
