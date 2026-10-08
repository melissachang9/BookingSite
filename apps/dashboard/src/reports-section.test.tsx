import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentsReport, ClientsReport, SalesReport, TeamReport } from "@booking/shared-types";

import { platformApi } from "./platform-api";
import { ReportsSection } from "./reports-section";

const range = { startDate: "2026-09-09", endDate: "2026-10-08", timezone: "America/Los_Angeles", groupBy: "day" as const, dayCount: 30 };

const salesReport: SalesReport = {
  range,
  kpis: {
    grossSalesCents: 600000,
    discountsCents: 5000,
    netSalesCents: 595000,
    taxCents: 40000,
    tipsCents: 30000,
    completedAppointments: 40,
    averageTicketCents: 14875,
    addOnSalesCents: 20000,
    addOnAttachRate: 0.25,
  },
  previousRange: range,
  previousKpis: {
    grossSalesCents: 400000,
    discountsCents: 5000,
    netSalesCents: 397500,
    taxCents: 0,
    tipsCents: 0,
    completedAppointments: 30,
    averageTicketCents: 13250,
    addOnSalesCents: 0,
    addOnAttachRate: 0,
  },
  series: [
    { bucketStart: "2026-09-09", grossSalesCents: 1000, netSalesCents: 900, tipsCents: 100, appointments: 1 },
    { bucketStart: "2026-09-10", grossSalesCents: 2000, netSalesCents: 1900, tipsCents: 0, appointments: 2 },
  ],
  byService: [{ key: "s1", label: "Signature Facial", appointments: 20, grossSalesCents: 1, discountsCents: 0, netSalesCents: 300000, tipsCents: 0 }],
  byCategory: [],
  byProvider: [{ key: "p1", label: "Jordan Rivera", appointments: 20, grossSalesCents: 1, discountsCents: 0, netSalesCents: 200000, tipsCents: 0 }],
  byLocation: [],
  byChannel: [],
  cash: {
    collectedCents: 650000,
    refundedCents: 9700,
    walletCreditedCents: 0,
    walletAppliedCents: 0,
    depositsForfeitedCents: 0,
    noShowFeesCents: 0,
    paymentMethods: [{ method: "card", payments: 30, amountCents: 500000, tipsCents: 20000 }],
  },
  outstanding: { outstandingBalanceCents: 0, followUpCount: 0 },
};

const teamReport = (includeFinancial: boolean): TeamReport => ({
  range,
  includeFinancial,
  members: [
    {
      providerId: "p1",
      name: "Jordan Rivera",
      isActive: true,
      appointmentsCompleted: 27,
      appointmentsScheduled: 30,
      noShows: 2,
      canceled: 3,
      noShowRate: 0.069,
      cancelRate: 0.1,
      newClientAppointments: 1,
      newClientShare: 0.037,
      rebookedAppointments: 18,
      rebookingRate: 0.67,
      bookedMinutes: 2220,
      scheduledMinutes: 10680,
      utilizationRate: 0.2079,
      ...(includeFinancial ? { netSalesCents: 212464, commissionCents: 87959, tipsCents: 10000, averageTicketCents: 7870 } : {}),
    },
  ],
  totals: { appointmentsCompleted: 27, bookedMinutes: 2220, scheduledMinutes: 10680, utilizationRate: 0.2079 },
});

const emptyAppointments: AppointmentsReport = {
  range,
  summary: {
    total: 0, completed: 0, upcoming: 0, canceled: 0, noShows: 0, noShowRate: null, cancelRate: null,
    lateCancelCount: 0, lateCancelRate: null, rescheduleRate: null, averageLeadTimeDays: null,
    averageWaitMinutes: null, averageLateStartMinutes: null,
  },
  statusMix: [], leadTime: [], cancelActors: [], cancelReasons: [], channels: [], bookingMethods: [], heatmap: [],
  drafts: { total: 0, confirmed: 0, abandoned: 0, conversionRate: null },
  resources: [],
};

const baseProps = {
  tenantSlug: "brow-beauty-lab",
  tenantTimezone: "America/Los_Angeles",
  canViewReports: true,
  canViewFinancial: true,
  canExport: true,
};

beforeEach(() => {
  vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [] } as never);
  vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({ providers: [] } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReportsSection", () => {
  it("shows sales KPIs, breakdowns and comparison deltas for a financial user", async () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    render(<ReportsSection {...baseProps} />);

    expect(await screen.findByText("$5,950")).toBeInTheDocument(); // net sales
    expect(screen.getByText("Gross minus discounts")).toBeInTheDocument();
    expect(screen.getAllByText("Signature Facial").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/▲ 50% vs\. prior/).length).toBeGreaterThan(0); // 595000 vs 397500
    expect(screen.getByRole("tab", { name: "Sales" })).toHaveAttribute("aria-selected", "true");
    expect(sales).toHaveBeenCalledWith(
      "brow-beauty-lab",
      expect.objectContaining({ groupBy: "day" }),
      undefined,
    );
  });

  it("requests the prior period when comparison is switched on", async () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    render(<ReportsSection {...baseProps} />);
    await screen.findByText("$5,950");

    fireEvent.click(screen.getByLabelText("Compare to prior period"));
    await waitFor(() => expect(sales).toHaveBeenLastCalledWith("brow-beauty-lab", expect.anything(), "prior_period"));
  });

  it("hides financial reports and figures without reports.financial", async () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    vi.spyOn(platformApi, "getTeamReport").mockResolvedValue(teamReport(false));
    render(<ReportsSection {...baseProps} canViewFinancial={false} canExport={false} />);

    expect(screen.queryByRole("tab", { name: "Sales" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Team performance" })).toBeInTheDocument();
    expect(screen.getByText("Jordan Rivera", { selector: "th" })).toBeInTheDocument();
    expect(screen.queryByText("Commission")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated commission")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(sales).not.toHaveBeenCalled();
  });

  it("shows commission and utilization on the team report for financial users", async () => {
    vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    vi.spyOn(platformApi, "getTeamReport").mockResolvedValue(teamReport(true));
    render(<ReportsSection {...baseProps} />);

    fireEvent.click(await screen.findByRole("tab", { name: "Team" }));
    expect(await screen.findByText("Estimated commission")).toBeInTheDocument();
    expect(screen.getAllByText("21%").length).toBeGreaterThan(0); // utilization 0.2079
    expect(screen.getByText("$879.59")).toBeInTheDocument(); // commission in the table / tiles
  });

  it("does not fetch and explains when the user cannot view reports", () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    render(<ReportsSection {...baseProps} canViewReports={false} />);
    expect(screen.getByText("You do not have permission to view reports.")).toBeInTheDocument();
    expect(sales).not.toHaveBeenCalled();
  });

  it("shows an error message when a report fails to load", async () => {
    vi.spyOn(platformApi, "getSalesReport").mockRejectedValue(new Error("Report service unavailable"));
    render(<ReportsSection {...baseProps} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Report service unavailable");
  });

  it("shows an empty state when there are no appointments", async () => {
    vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    vi.spyOn(platformApi, "getAppointmentsReport").mockResolvedValue(emptyAppointments);
    render(<ReportsSection {...baseProps} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Appointments" }));
    expect(await screen.findByText("No appointments in this range.")).toBeInTheDocument();
  });

  it("renders the clients report with retention and sources", async () => {
    vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    const clients: ClientsReport = {
      range,
      includeFinancial: true,
      summary: {
        totalClients: 49, activeClients: 27, newClients: 11, returningClients: 22, newClientShare: 0.33,
        averageVisitsPerActiveClient: 2.4, rebookingRate: 0.8, blockedClients: 0, walletHolders: 16,
        walletLiabilityCents: 70000, averageLifetimeValueCents: 51462,
      },
      retention: [{ windowDays: 30, eligible: 32, retained: 27, rate: 0.84 }],
      cohorts: [],
      sources: [{ key: "google", label: "Google", count: 4 }],
      topClients: [{ customerId: "c1", name: "Ivy Cole", visits: 7, spendCents: 55997, lastVisit: "2026-10-07" }],
      atRiskCount: 0,
      atRisk: [],
    };
    vi.spyOn(platformApi, "getClientsReport").mockResolvedValue(clients);
    render(<ReportsSection {...baseProps} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Clients" }));

    expect(await screen.findByText("84%")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ivy Cole" })).toHaveAttribute("href", "/customers?customerId=c1");
    expect(screen.getByText("No clients are at risk.")).toBeInTheDocument();
  });

  it("exports the current report as CSV and surfaces export failures", async () => {
    vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    const exportCsv = vi.spyOn(platformApi, "exportReportCsv").mockRejectedValueOnce(new Error("Export failed"));
    render(<ReportsSection {...baseProps} />);
    await screen.findByText("$5,950");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText("Export failed")).toBeInTheDocument();
    expect(exportCsv).toHaveBeenCalledWith("brow-beauty-lab", "sales", expect.objectContaining({ from: expect.any(String) }));
  });

  it("blocks an inverted custom date range without calling the API again", async () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    const { container } = render(<ReportsSection {...baseProps} />);
    await screen.findByText("$5,950");

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    const [from] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    fireEvent.change(from!, { target: { value: "2099-01-01" } });

    expect(await screen.findByText("The start date must be on or before the end date.")).toBeInTheDocument();
    const callsAfter = sales.mock.calls.length;
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.queryByText("$5,950")).not.toBeInTheDocument();
    expect(sales.mock.calls.length).toBe(callsAfter);
  });
});
