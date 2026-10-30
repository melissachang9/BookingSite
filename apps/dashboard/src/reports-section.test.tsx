import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentsReport, ClientsReport, SalesReport, TaxReport, TeamReport } from "@booking/shared-types";

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
  margin: { costCents: 2000, costedSalesCents: 8000, totalSalesCents: 10000, grossProfitCents: 6000, margin: 0.75, coverage: 0.8 },
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
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));

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
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));
    await screen.findByText("$5,950");

    fireEvent.click(screen.getByLabelText("Compare to prior period"));
    await waitFor(() => expect(sales).toHaveBeenLastCalledWith("brow-beauty-lab", expect.anything(), "prior_period"));
  });

  it("hides financial reports and figures without reports.financial", async () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    vi.spyOn(platformApi, "getTeamReport").mockResolvedValue(teamReport(false));
    render(<ReportsSection {...baseProps} canViewFinancial={false} canExport={false} />);

    expect(screen.queryByRole("tab", { name: "Sales" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Team" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));
    await screen.findByText("$5,950");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText("Export failed")).toBeInTheDocument();
    expect(exportCsv).toHaveBeenCalledWith("brow-beauty-lab", "sales", expect.objectContaining({ from: expect.any(String) }));
  });

  it("blocks an inverted custom date range without calling the API again", async () => {
    const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
    const { container } = render(<ReportsSection {...baseProps} />);
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));
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

  describe("Profit", () => {
    it("shows profit and how much of the sales have a cost", async () => {
      vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
      render(<ReportsSection {...baseProps} />);
      fireEvent.click(screen.getByRole("tab", { name: "Sales" }));

      const profit = await screen.findByRole("region", { name: "Profit" });
      expect(within(profit).getByText("Gross profit").parentElement).toHaveTextContent("$60");
      expect(within(profit).getByText("Margin").parentElement).toHaveTextContent("75%");
      expect(within(profit).getByText("Sales with a cost").parentElement).toHaveTextContent("80%");
    });

    it("explains how to see profit when no costs are entered", async () => {
      vi.spyOn(platformApi, "getSalesReport").mockResolvedValue({
        ...salesReport,
        margin: { costCents: 0, costedSalesCents: 0, totalSalesCents: 10000, grossProfitCents: 0, margin: null, coverage: 0 },
      });
      render(<ReportsSection {...baseProps} />);
      fireEvent.click(screen.getByRole("tab", { name: "Sales" }));

      expect(await screen.findByText(/No costs entered yet/)).toBeInTheDocument();
      expect(screen.queryByText("Gross profit")).toBeNull();
    });
  });

  describe("Tax", () => {
    const taxReport: TaxReport = {
      startDate: "2026-09-09",
      endDate: "2026-10-08",
      salesCount: 12,
      salesCents: 250000,
      taxableSalesCents: 200000,
      taxCollectedCents: 17500,
      byKind: [
        { kind: "service", salesCents: 200000, taxCents: 15000 },
        { kind: "add_on", salesCents: 30000, taxCents: 2500 },
        { kind: "product", salesCents: 20000, taxCents: 0 },
      ],
      byLocation: [{ locationId: "loc-1", locationName: "Downtown", salesCents: 250000, taxCents: 17500 }],
    };

    it("shows tax collected, taxable sales and the breakdowns", async () => {
      vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
      const tax = vi.spyOn(platformApi, "getTaxReport").mockResolvedValue(taxReport);
      render(<ReportsSection {...baseProps} />);
      fireEvent.click(screen.getByRole("tab", { name: "Tax" }));

      expect((await screen.findByText("Tax collected", { selector: ".rp-kpi__label" })).parentElement).toHaveTextContent("$175");
      expect(screen.getByText("Taxable sales").parentElement).toHaveTextContent("$2,000");
      const byKind = screen.getByRole("table", { name: "Tax by kind" });
      expect(within(byKind).getByRole("row", { name: /Add-ons/ })).toHaveTextContent("$25");
      expect(within(screen.getByRole("table", { name: "Tax by location" })).getByText("Downtown")).toBeInTheDocument();
      expect(screen.getByText(/Discounts and\s+refunds are not netted out/)).toBeInTheDocument();
      expect(tax).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({ from: expect.any(String) }));
    });

    it("exports the tax report as CSV", async () => {
      vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
      vi.spyOn(platformApi, "getTaxReport").mockResolvedValue(taxReport);
      const exportCsv = vi.spyOn(platformApi, "exportReportCsv").mockRejectedValueOnce(new Error("Export failed"));
      render(<ReportsSection {...baseProps} />);
      fireEvent.click(screen.getByRole("tab", { name: "Tax" }));
      await screen.findByRole("table", { name: "Tax by kind" });

      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
      await screen.findByText("Export failed");
      expect(exportCsv).toHaveBeenCalledWith("brow-beauty-lab", "tax", expect.anything());
    });

    it("says so when there are no completed sales", async () => {
      vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
      vi.spyOn(platformApi, "getTaxReport").mockResolvedValue({
        ...taxReport, salesCount: 0, salesCents: 0, taxableSalesCents: 0, taxCollectedCents: 0, byKind: [], byLocation: [],
      });
      render(<ReportsSection {...baseProps} />);
      fireEvent.click(screen.getByRole("tab", { name: "Tax" }));

      expect((await screen.findAllByText("No completed sales in this range.")).length).toBe(2);
    });

    it("is hidden, and never requested, without financial access", () => {
      const tax = vi.spyOn(platformApi, "getTaxReport");
      vi.spyOn(platformApi, "getTeamReport").mockResolvedValue(teamReport(false));
      vi.spyOn(platformApi, "getClientsReport").mockResolvedValue({
        range, includeFinancial: false,
        summary: {
          totalClients: 0, activeClients: 0, newClients: 0, returningClients: 0, newClientShare: null,
          averageVisitsPerActiveClient: null, rebookingRate: null, blockedClients: 0, walletHolders: 0,
        },
        retention: [], cohorts: [], sources: [], topClients: [], atRiskCount: 0, atRisk: [],
      });
      vi.spyOn(platformApi, "getAppointmentsReport").mockResolvedValue(emptyAppointments);
      render(<ReportsSection {...baseProps} canViewFinancial={false} canExport={false} />);

      expect(screen.queryByRole("tab", { name: "Tax" })).toBeNull();
      expect(tax).not.toHaveBeenCalled();
    });
  });

  describe("Overview", () => {
    const clientsReport: ClientsReport = {
      range,
      includeFinancial: true,
      summary: {
        totalClients: 49, activeClients: 27, newClients: 11, returningClients: 22, newClientShare: 0.33,
        averageVisitsPerActiveClient: 2.4, rebookingRate: 0.8, blockedClients: 0, walletHolders: 16,
        walletLiabilityCents: 70000, averageLifetimeValueCents: 51462,
      },
      retention: [], cohorts: [],
      sources: [{ key: "instagram", label: "Instagram", count: 6 }],
      topClients: [], atRiskCount: 3, atRisk: [],
    };

    function mockAll() {
      vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
      vi.spyOn(platformApi, "getTeamReport").mockResolvedValue(teamReport(true));
      vi.spyOn(platformApi, "getClientsReport").mockResolvedValue(clientsReport);
      vi.spyOn(platformApi, "getAppointmentsReport").mockResolvedValue(emptyAppointments);
    }

    it("opens on the overview with a headline card for each area", async () => {
      mockAll();
      render(<ReportsSection {...baseProps} />);

      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
      const sales = await screen.findByRole("region", { name: "Sales" });
      expect(await within(sales).findByText("$5,950")).toBeInTheDocument();
      expect(within(sales).getAllByText(/▲ 50% vs\. prior/).length).toBeGreaterThan(0);
      const clients = screen.getByRole("region", { name: "Clients" });
      expect(await within(clients).findByText("11")).toBeInTheDocument(); // new clients
      expect(within(clients).getByText("90+ days since last visit").parentElement).toHaveTextContent("3");
      expect(await within(screen.getByRole("region", { name: "Team" })).findByText("21%")).toBeInTheDocument();
      expect(await within(screen.getByRole("region", { name: "Marketing" })).findByText("Instagram")).toBeInTheDocument();
    });

    it("jumps to the full report from a card", async () => {
      mockAll();
      render(<ReportsSection {...baseProps} />);

      fireEvent.click(await screen.findByRole("button", { name: "Open Team report" }));
      expect(screen.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
      expect(await screen.findByText("Jordan Rivera", { selector: "th" })).toBeInTheDocument();
    });

    it("leaves out sales and marketing, and never asks for sales data, without financial access", async () => {
      const sales = vi.spyOn(platformApi, "getSalesReport").mockResolvedValue(salesReport);
      vi.spyOn(platformApi, "getTeamReport").mockResolvedValue(teamReport(false));
      vi.spyOn(platformApi, "getClientsReport").mockResolvedValue({ ...clientsReport, includeFinancial: false });
      vi.spyOn(platformApi, "getAppointmentsReport").mockResolvedValue(emptyAppointments);
      render(<ReportsSection {...baseProps} canViewFinancial={false} canExport={false} />);

      expect(await screen.findByRole("region", { name: "Clients" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Sales" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Marketing" })).toBeNull();
      expect(sales).not.toHaveBeenCalled();
    });

    it("keeps the other cards when one report fails", async () => {
      mockAll();
      vi.spyOn(platformApi, "getAppointmentsReport").mockRejectedValue(new Error("Appointments are down"));
      render(<ReportsSection {...baseProps} />);

      expect(await within(await screen.findByRole("region", { name: "Appointments" })).findByRole("alert")).toHaveTextContent("Appointments are down");
      expect(await within(screen.getByRole("region", { name: "Team" })).findByText("21%")).toBeInTheDocument();
    });

    it("explains every metric, marking the ones that need more data", async () => {
      mockAll();
      render(<ReportsSection {...baseProps} />);
      await screen.findByRole("region", { name: "Sales" });

      fireEvent.click(screen.getByText("Metric definitions"));
      const acquisition = screen.getByRole("region", { name: "Acquisition metrics" });
      expect(within(acquisition).getByText(/Customer acquisition cost/)).toBeInTheDocument();
      // LTV:CAC and payback are defined now but can't be reported until the data exists.
      const planned = within(acquisition).getByText("LTV : CAC").closest("div");
      expect(planned).toHaveTextContent("Coming later");
      expect(planned).toHaveTextContent("Needs:");
      const reported = within(acquisition).getByText("Online booking conversion").closest("div");
      expect(reported).not.toHaveTextContent("Coming later");
      expect(reported).toHaveTextContent("Shown in: Appointments, Overview.");
    });

    it("hides Export CSV, which has nothing to export on the overview", async () => {
      mockAll();
      render(<ReportsSection {...baseProps} />);
      await screen.findByRole("region", { name: "Sales" });
      expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
    });
  });
});
