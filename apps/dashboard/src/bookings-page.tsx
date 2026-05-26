import { startTransition, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import type {
  AuthenticatedUser,
  BookingListQuery,
  BookingListResponse,
  BookingSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  RecordManualPaymentRequest,
  UpdateBookingStatusRequest,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type BookingsState =
  | { kind: "loading" }
  | { kind: "ready"; items: BookingSummary[] }
  | { kind: "error"; message: string };

type BookingActionState =
  | { kind: "idle" }
  | { kind: "submitting"; bookingId: string; label: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type BookingCollectionMethod = "cash" | "external_pos";

export type BookingsPageDefinition = {
  eyebrow: string;
  description: string;
  metric: string;
};

export type BookingsPageApi = {
  listBookings: (tenantSlug: string, query?: BookingListQuery) => Promise<BookingListResponse>;
  recordManualPayment: (tenantSlug: string, bookingId: string, body: RecordManualPaymentRequest) => Promise<BookingSummary>;
  updateBookingStatus: (tenantSlug: string, bookingId: string, body: UpdateBookingStatusRequest) => Promise<BookingSummary>;
  createCheckoutSession: (body: CreateCheckoutSessionRequest) => Promise<CreateCheckoutSessionResponse>;
};

type BookingsPageProps = {
  definition: BookingsPageDefinition;
  currentUser: AuthenticatedUser | null;
  api?: BookingsPageApi;
  storefrontBaseUrl?: string;
};

const defaultStorefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dayLabelFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function parseMoneyInput(value: string): number | null {
  const normalizedValue = value.replace(/[$,\s]/g, "");
  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Math.round(parsedValue * 100);
}

function formatMoneyInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    throw new Error("Clipboard access is not available in this browser.");
  }

  await navigator.clipboard.writeText(value);
}

function getBookingLifecycleTone(booking: BookingSummary): "ready" | "progress" | "planned" {
  if (booking.status === "confirmed") {
    return booking.balanceDueCents > 0 ? "progress" : "ready";
  }

  if (booking.status === "completed") {
    return booking.paymentResolution === "follow_up" ? "progress" : "ready";
  }

  return "planned";
}

function getBookingLifecycleLabel(booking: BookingSummary): string {
  if (booking.status === "confirmed") {
    return booking.balanceDueCents > 0 ? "Confirmed balance due" : "Confirmed paid";
  }

  if (booking.status === "completed") {
    if (booking.paymentResolution === "follow_up") {
      return "Completed follow-up";
    }

    if (booking.paymentResolution === "waived") {
      return "Completed waived";
    }

    return "Completed";
  }

  return "No-show";
}

function getBookingResolutionLabel(booking: BookingSummary): string {
  if (booking.paymentResolution === "follow_up") {
    return "Follow-up";
  }

  if (booking.paymentResolution === "waived") {
    return "Waived";
  }

  if (booking.paymentResolution === "collected") {
    return booking.balanceDueCents > 0 ? "Collected" : "Paid";
  }

  return "Pending";
}

export function BookingsPage({
  definition,
  currentUser,
  api = platformApi,
  storefrontBaseUrl = defaultStorefrontBaseUrl,
}: BookingsPageProps) {
  const [bookingsState, setBookingsState] = useState<BookingsState>({ kind: "loading" });
  const [actionState, setActionState] = useState<BookingActionState>({ kind: "idle" });
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const canViewBookings = currentUser !== null && hasPermission(currentUser, "bookings.view");
  const canCompleteBookings = currentUser !== null && hasPermission(currentUser, "bookings.complete");
  const canCollectPayments = currentUser !== null && hasPermission(currentUser, "bookings.collect_payment");
  const tenantSlug = currentUser?.tenantSlug ?? "";

  const loadBookings = async () => {
    const response = await api.listBookings(tenantSlug, {
      status: ["confirmed", "completed", "no_show"],
      limit: 60,
    });

    startTransition(() => {
      setBookingsState({ kind: "ready", items: response.items });
      setAmountDrafts((current) => {
        const next = { ...current };
        for (const booking of response.items) {
          if (booking.balanceDueCents > 0 && next[booking.id] === undefined) {
            next[booking.id] = formatMoneyInputValue(booking.balanceDueCents);
          }
        }
        return next;
      });
    });

    return response.items;
  };

  useEffect(() => {
    let isCancelled = false;

    if (!canViewBookings) {
      setBookingsState({ kind: "error", message: "Your role can access the dashboard, but it cannot review booking lifecycle work." });
      return () => {
        isCancelled = true;
      };
    }

    if (!tenantSlug) {
      setBookingsState({ kind: "error", message: "Tenant session is missing tenant context." });
      return () => {
        isCancelled = true;
      };
    }

    const loadLifecycleQueue = async () => {
      try {
        const response = await api.listBookings(tenantSlug, {
          status: ["confirmed", "completed", "no_show"],
          limit: 60,
        });
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setBookingsState({ kind: "ready", items: response.items });
          setAmountDrafts((current) => {
            const next = { ...current };
            for (const booking of response.items) {
              if (booking.balanceDueCents > 0 && next[booking.id] === undefined) {
                next[booking.id] = formatMoneyInputValue(booking.balanceDueCents);
              }
            }
            return next;
          });
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setBookingsState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load booking lifecycle work.",
          });
        });
      }
    };

    void loadLifecycleQueue();

    return () => {
      isCancelled = true;
    };
  }, [api, canViewBookings, tenantSlug]);

  const getAmountDraft = (booking: BookingSummary) =>
    amountDrafts[booking.id] ?? (booking.balanceDueCents > 0 ? formatMoneyInputValue(booking.balanceDueCents) : "");

  const parseCollectedAmount = (booking: BookingSummary) => {
    const parsedAmount = parseMoneyInput(getAmountDraft(booking));
    if (parsedAmount === null) {
      throw new Error("Enter the exact collected amount before recording the balance.");
    }
    return parsedAmount;
  };

  const reloadAfterActionFailure = async () => {
    if (!tenantSlug || !canViewBookings) {
      return;
    }

    try {
      await loadBookings();
    } catch {
      return;
    }
  };

  const runBookingAction = async (bookingId: string, label: string, work: () => Promise<string>) => {
    setActionState({ kind: "submitting", bookingId, label });

    try {
      const message = await work();
      await loadBookings();

      startTransition(() => {
        setActionState({ kind: "success", message });
      });
    } catch (error) {
      await reloadAfterActionFailure();

      startTransition(() => {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to update the booking lifecycle state.",
        });
      });
    }
  };

  const handleCollectBalance = (booking: BookingSummary, paymentMethodType: BookingCollectionMethod) => {
    if (!tenantSlug || !canCollectPayments) {
      return;
    }

    const paymentMethodLabel = paymentMethodType === "cash" ? "cash" : "external POS";

    void runBookingAction(
      booking.id,
      booking.status === "confirmed" ? `Collecting ${paymentMethodLabel} and completing visit...` : `Recording ${paymentMethodLabel} balance...`,
      async () => {
        const amountCents = parseCollectedAmount(booking);
        await api.recordManualPayment(tenantSlug, booking.id, {
          amountCents,
          paymentMethodType,
        });

        if (booking.status === "confirmed") {
          await api.updateBookingStatus(tenantSlug, booking.id, {
            status: "completed",
            paymentResolution: "collected",
          });
          return `Collected ${formatMoney(amountCents)} by ${paymentMethodLabel} and marked the visit completed.`;
        }

        return `Recorded ${formatMoney(amountCents)} by ${paymentMethodLabel}.`;
      },
    );
  };

  const createHostedBalanceCheckout = async (booking: BookingSummary) =>
    api.createCheckoutSession({
      tenantSlug,
      bookingId: booking.id,
      kind: "booking_balance",
      successUrl: `${storefrontBaseUrl}/cancel/${booking.customerManageToken}?sessionId={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${storefrontBaseUrl}/cancel/${booking.customerManageToken}`,
    });

  const handleOpenHostedCheckout = (booking: BookingSummary) => {
    if (!tenantSlug || !canCollectPayments) {
      return;
    }

    void runBookingAction(booking.id, "Preparing hosted checkout...", async () => {
      const checkoutSession = await createHostedBalanceCheckout(booking);
      window.open(checkoutSession.checkoutUrl, "_blank", "noopener,noreferrer");
      return "Opened the hosted balance checkout in a new tab.";
    });
  };

  const handleCopyHostedCheckout = (booking: BookingSummary) => {
    if (!tenantSlug || !canCollectPayments) {
      return;
    }

    void runBookingAction(booking.id, "Copying hosted checkout...", async () => {
      const checkoutSession = await createHostedBalanceCheckout(booking);
      await copyTextToClipboard(checkoutSession.checkoutUrl);
      return "Copied the hosted balance checkout link to the clipboard.";
    });
  };

  const handleCompleteWithFollowUp = (booking: BookingSummary) => {
    if (!tenantSlug || !canCompleteBookings) {
      return;
    }

    void runBookingAction(booking.id, "Completing with follow-up...", async () => {
      await api.updateBookingStatus(tenantSlug, booking.id, {
        status: "completed",
        paymentResolution: "follow_up",
      });
      return "Marked the visit completed with balance follow-up still due.";
    });
  };

  const handleCompleteAsPaid = (booking: BookingSummary) => {
    if (!tenantSlug || !canCompleteBookings) {
      return;
    }

    void runBookingAction(booking.id, "Completing visit...", async () => {
      await api.updateBookingStatus(tenantSlug, booking.id, {
        status: "completed",
        paymentResolution: "collected",
      });
      return booking.amountPaidCents > 0 ? "Marked the visit completed as already paid." : "Marked the visit completed with no balance due.";
    });
  };

  const handleWaiveBalance = (booking: BookingSummary) => {
    if (!tenantSlug || !canCompleteBookings) {
      return;
    }

    if (typeof window !== "undefined" && !window.confirm("Complete this booking and waive the remaining balance?")) {
      return;
    }

    void runBookingAction(booking.id, "Completing with waived balance...", async () => {
      await api.updateBookingStatus(tenantSlug, booking.id, {
        status: "completed",
        paymentResolution: "waived",
      });
      return "Completed the visit and waived the remaining balance.";
    });
  };

  const handleMarkNoShow = (booking: BookingSummary) => {
    if (!tenantSlug || !canCompleteBookings) {
      return;
    }

    if (typeof window !== "undefined" && !window.confirm("Mark this booking as a no-show?")) {
      return;
    }

    void runBookingAction(booking.id, "Marking no-show...", async () => {
      await api.updateBookingStatus(tenantSlug, booking.id, {
        status: "no_show",
      });
      return "Marked the booking as a no-show.";
    });
  };

  const actionableBookings =
    bookingsState.kind === "ready"
      ? bookingsState.items.filter(
          (booking) =>
            booking.status === "confirmed" ||
            (booking.status === "completed" && booking.paymentResolution === "follow_up" && booking.balanceDueCents > 0),
        )
      : [];
  const actionableIds = new Set(actionableBookings.map((booking) => booking.id));
  const finalizedBookings =
    bookingsState.kind === "ready"
      ? bookingsState.items.filter((booking) => !actionableIds.has(booking.id)).slice().reverse().slice(0, 6)
      : [];

  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>Move confirmed visits through completion without losing payment truth.</h3>
          <p>{definition.description}</p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Lifecycle queue</p>
          <strong>{bookingsState.kind === "ready" ? `${actionableBookings.length} needing action` : definition.metric}</strong>
          <span>Operators can collect the exact remaining balance, complete with follow-up, waive the remainder, or keep no-shows separate.</span>
        </div>
      </section>

      <section className="catalog-layout">
        <article className="ops-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Lifecycle queue</p>
              <h4>Confirmed visits and balance follow-up</h4>
            </div>
            {bookingsState.kind === "ready" ? (
              <span className="status-chip status-chip--progress">{actionableBookings.length} active</span>
            ) : null}
          </div>

          {actionState.kind !== "idle" ? (
            <div className={actionState.kind === "error" ? "message-banner message-banner--error" : "message-banner"}>
              {actionState.kind === "submitting" ? actionState.label : actionState.message}
            </div>
          ) : null}

          {!canCompleteBookings && canViewBookings ? (
            <div className="message-banner message-banner--muted">Your role can review lifecycle work, but it cannot complete visits or mark no-shows.</div>
          ) : null}

          {canCompleteBookings && !canCollectPayments ? (
            <div className="message-banner message-banner--muted">This role can finalize visits, but it cannot record cash or external POS balance collection.</div>
          ) : null}

          {bookingsState.kind === "loading" ? (
            <div className="calendar-state">Loading booking lifecycle queue...</div>
          ) : bookingsState.kind === "error" ? (
            <div className="calendar-state calendar-state--muted">{bookingsState.message}</div>
          ) : actionableBookings.length === 0 ? (
            <div className="calendar-state calendar-state--muted">No confirmed visits or follow-up balances need action right now.</div>
          ) : (
            <div className="service-catalog-list">
              {actionableBookings.map((booking) => {
                const isSubmitting = actionState.kind === "submitting" && actionState.bookingId === booking.id;
                const canFinalizePaid = canCompleteBookings && booking.balanceDueCents <= 0 && booking.status === "confirmed";
                const canFinalizeWithBalance = canCompleteBookings && booking.balanceDueCents > 0 && booking.status === "confirmed";

                return (
                  <article key={booking.id} className="service-catalog-card">
                    <div className="panel-title-row">
                      <div>
                        <p className="eyebrow">{booking.status === "completed" ? "Balance follow-up" : "Confirmed visit"}</p>
                        <h5>{booking.customer.name}</h5>
                      </div>
                      <span className={`status-chip status-chip--${getBookingLifecycleTone(booking)}`}>{getBookingLifecycleLabel(booking)}</span>
                    </div>
                    <p>
                      {booking.service.name} with {booking.provider.name} on {formatDateTime(booking.startsAt)}.
                    </p>
                    <dl className="service-stats">
                      <div>
                        <dt>Collected</dt>
                        <dd>{formatMoney(booking.amountPaidCents)}</dd>
                      </div>
                      <div>
                        <dt>Balance due</dt>
                        <dd>{booking.balanceDueCents > 0 ? formatMoney(booking.balanceDueCents) : "None"}</dd>
                      </div>
                      <div>
                        <dt>Outcome</dt>
                        <dd>{getBookingResolutionLabel(booking)}</dd>
                      </div>
                    </dl>
                    <div className="catalog-location-list">
                      <span className="status-chip status-chip--planned">{booking.provider.name}</span>
                      <span className="status-chip status-chip--planned">{booking.customer.email}</span>
                      <span className={`status-chip status-chip--${booking.paymentResolution === "follow_up" ? "progress" : "planned"}`}>
                        {getBookingResolutionLabel(booking)}
                      </span>
                    </div>

                    {booking.balanceDueCents > 0 ? (
                      <div className="form-grid">
                        <label className="form-grid__full">
                          Exact collected amount
                          <input
                            type="text"
                            inputMode="decimal"
                            value={getAmountDraft(booking)}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setAmountDrafts((current) => ({ ...current, [booking.id]: nextValue }));
                            }}
                            disabled={isSubmitting || !canCollectPayments}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="action-row">
                      {booking.balanceDueCents > 0 ? (
                        <>
                          <button
                            type="button"
                            className="primary-action"
                            disabled={!canCollectPayments || (booking.status === "confirmed" && !canCompleteBookings) || isSubmitting}
                            onClick={() => {
                              handleCollectBalance(booking, "cash");
                            }}
                          >
                            {booking.status === "confirmed" ? "Collect cash & complete" : "Record cash balance"}
                          </button>
                          <button
                            type="button"
                            className="secondary-action"
                            disabled={!canCollectPayments || (booking.status === "confirmed" && !canCompleteBookings) || isSubmitting}
                            onClick={() => {
                              handleCollectBalance(booking, "external_pos");
                            }}
                          >
                            {booking.status === "confirmed" ? "External POS & complete" : "Record external POS"}
                          </button>
                          <button
                            type="button"
                            className="secondary-action"
                            disabled={!canCollectPayments || isSubmitting}
                            onClick={() => {
                              handleOpenHostedCheckout(booking);
                            }}
                          >
                            Open hosted checkout
                          </button>
                          <button
                            type="button"
                            className="secondary-action"
                            disabled={!canCollectPayments || isSubmitting}
                            onClick={() => {
                              handleCopyHostedCheckout(booking);
                            }}
                          >
                            Copy hosted checkout
                          </button>
                          {canFinalizeWithBalance ? (
                            <button
                              type="button"
                              className="secondary-action"
                              disabled={!canCompleteBookings || isSubmitting}
                              onClick={() => {
                                handleCompleteWithFollowUp(booking);
                              }}
                            >
                              Complete with follow-up
                            </button>
                          ) : null}
                          {canFinalizeWithBalance ? (
                            <button
                              type="button"
                              className="secondary-action"
                              disabled={!canCompleteBookings || isSubmitting}
                              onClick={() => {
                                handleWaiveBalance(booking);
                              }}
                            >
                              Waive balance & complete
                            </button>
                          ) : null}
                        </>
                      ) : canFinalizePaid ? (
                        <button
                          type="button"
                          className="primary-action"
                          disabled={!canCompleteBookings || isSubmitting}
                          onClick={() => {
                            handleCompleteAsPaid(booking);
                          }}
                        >
                          {booking.amountPaidCents > 0 ? "Complete as paid" : "Complete with no balance due"}
                        </button>
                      ) : null}

                      {booking.status === "confirmed" ? (
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={!canCompleteBookings || isSubmitting}
                          onClick={() => {
                            handleMarkNoShow(booking);
                          }}
                        >
                          Mark no-show
                        </button>
                      ) : null}

                      <NavLink to="/calendar" className="secondary-action">
                        Open calendar
                      </NavLink>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <aside className="ops-panel">
          <p className="eyebrow">Recent outcomes</p>
          <h4>Completed and no-show visits</h4>

          {bookingsState.kind === "ready" && finalizedBookings.length > 0 ? (
            <div className="service-catalog-list">
              {finalizedBookings.map((booking) => (
                <article key={booking.id} className="service-catalog-card">
                  <div className="panel-title-row">
                    <div>
                      <p className="eyebrow">{booking.status === "no_show" ? "No-show" : "Completed"}</p>
                      <h5>{booking.customer.name}</h5>
                    </div>
                    <span className={`status-chip status-chip--${getBookingLifecycleTone(booking)}`}>{getBookingLifecycleLabel(booking)}</span>
                  </div>
                  <p>
                    {booking.service.name} on {formatDateTime(booking.startsAt)}.
                  </p>
                  <dl className="service-stats">
                    <div>
                      <dt>Collected</dt>
                      <dd>{formatMoney(booking.amountPaidCents)}</dd>
                    </div>
                    <div>
                      <dt>Balance</dt>
                      <dd>{booking.balanceDueCents > 0 ? formatMoney(booking.balanceDueCents) : "Resolved"}</dd>
                    </div>
                    <div>
                      <dt>Outcome</dt>
                      <dd>{getBookingResolutionLabel(booking)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <div className="calendar-state calendar-state--muted">Completed and no-show visits will land here after the operator resolves them.</div>
          )}

          <ul className="check-list">
            <li>Confirmed visits stay actionable until the operator records an explicit payment outcome.</li>
            <li>Cash and external POS collection require the exact remaining balance amount from the operator.</li>
            <li>No-shows stay separate from completion so follow-up and fee handling can be added without hiding the terminal state.</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}