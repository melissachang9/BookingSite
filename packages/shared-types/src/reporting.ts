export type DashboardReport = {
  totalBookings: number;
  confirmedBookings: number;
  completedBookings: number;
  canceledBookings: number;
  noShowBookings: number;
  upcomingBookings: number;
  completedThisMonth: number;
  noShowsThisMonth: number;
  revenueThisMonthCents: number;
  balanceFollowUpCount: number;
};

// ---------------------------------------------------------------------------
// Business reports (Settings → Reports). Money is integer cents; rates are
// fractions (0.25 = 25%) or null when the denominator is zero.
// ---------------------------------------------------------------------------

export type ReportGroupBy = "day" | "week" | "month";
export type ReportCompareMode = "prior_period" | "prior_year";

export type ReportQuery = {
  /** Tenant-local dates, YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  groupBy?: ReportGroupBy;
  locationId?: string;
  providerId?: string;
};

export type ReportRange = {
  startDate: string;
  endDate: string;
  timezone: string;
  groupBy: ReportGroupBy;
  dayCount: number;
};

export type ReportCountRow = { key: string; label: string; count: number };

export type SalesKpis = {
  grossSalesCents: number;
  discountsCents: number;
  netSalesCents: number;
  taxCents: number;
  tipsCents: number;
  completedAppointments: number;
  averageTicketCents: number;
  addOnSalesCents: number;
  addOnAttachRate: number;
};

export type SalesPoint = {
  bucketStart: string;
  grossSalesCents: number;
  netSalesCents: number;
  tipsCents: number;
  appointments: number;
};

export type SalesBreakdownRow = {
  key: string;
  label: string;
  appointments: number;
  grossSalesCents: number;
  discountsCents: number;
  netSalesCents: number;
  tipsCents: number;
};

export type PaymentMethodRow = {
  method: string;
  payments: number;
  amountCents: number;
  tipsCents: number;
};

export type SalesReport = {
  range: ReportRange;
  kpis: SalesKpis;
  previousRange?: ReportRange | null;
  previousKpis?: SalesKpis | null;
  series: SalesPoint[];
  byService: SalesBreakdownRow[];
  byCategory: SalesBreakdownRow[];
  byProvider: SalesBreakdownRow[];
  byLocation: SalesBreakdownRow[];
  byChannel: SalesBreakdownRow[];
  cash: {
    collectedCents: number;
    refundedCents: number;
    walletCreditedCents: number;
    walletAppliedCents: number;
    depositsForfeitedCents: number;
    noShowFeesCents: number;
    paymentMethods: PaymentMethodRow[];
  };
  outstanding: { outstandingBalanceCents: number; followUpCount: number };
};

export type TeamMemberRow = {
  providerId: string;
  name: string;
  isActive: boolean;
  appointmentsCompleted: number;
  appointmentsScheduled: number;
  noShows: number;
  canceled: number;
  noShowRate: number | null;
  cancelRate: number | null;
  newClientAppointments: number;
  newClientShare: number | null;
  rebookedAppointments: number;
  rebookingRate: number | null;
  bookedMinutes: number;
  scheduledMinutes: number | null;
  utilizationRate: number | null;
  // Null unless the caller holds reports.financial.
  grossSalesCents?: number | null;
  discountsCents?: number | null;
  netSalesCents?: number | null;
  addOnSalesCents?: number | null;
  tipsCents?: number | null;
  averageTicketCents?: number | null;
  commissionCents?: number | null;
  compensationMode?: string | null;
};

export type TeamReport = {
  range: ReportRange;
  includeFinancial: boolean;
  members: TeamMemberRow[];
  totals: {
    appointmentsCompleted: number;
    bookedMinutes: number;
    scheduledMinutes: number | null;
    utilizationRate: number | null;
    netSalesCents?: number | null;
    tipsCents?: number | null;
    commissionCents?: number | null;
  };
};

export type ClientsReport = {
  range: ReportRange;
  includeFinancial: boolean;
  summary: {
    totalClients: number;
    activeClients: number;
    newClients: number;
    returningClients: number;
    newClientShare: number | null;
    averageVisitsPerActiveClient: number | null;
    rebookingRate: number | null;
    blockedClients: number;
    walletHolders: number;
    walletLiabilityCents?: number | null;
    averageLifetimeValueCents?: number | null;
  };
  retention: Array<{ windowDays: number; eligible: number; retained: number; rate: number | null }>;
  cohorts: Array<{
    month: string;
    newClients: number;
    eligible90Day: number;
    retained90Day: number;
    retentionRate: number | null;
  }>;
  sources: ReportCountRow[];
  topClients: Array<{
    customerId: string;
    name: string;
    visits: number;
    spendCents?: number | null;
    lastVisit?: string | null;
  }>;
  atRiskCount: number;
  atRisk: Array<{
    customerId: string;
    name: string;
    visits: number;
    lastVisit: string;
    daysSinceLastVisit: number;
    lifetimeSpendCents?: number | null;
  }>;
};

export type AppointmentsReport = {
  range: ReportRange;
  summary: {
    total: number;
    completed: number;
    upcoming: number;
    canceled: number;
    noShows: number;
    noShowRate: number | null;
    cancelRate: number | null;
    lateCancelCount: number;
    lateCancelRate: number | null;
    rescheduleRate: number | null;
    averageLeadTimeDays: number | null;
    averageWaitMinutes: number | null;
    averageLateStartMinutes: number | null;
  };
  statusMix: ReportCountRow[];
  leadTime: ReportCountRow[];
  cancelActors: ReportCountRow[];
  cancelReasons: ReportCountRow[];
  channels: ReportCountRow[];
  bookingMethods: ReportCountRow[];
  /** weekday 0 = Monday. */
  heatmap: Array<{ weekday: number; hour: number; count: number }>;
  drafts: { total: number; confirmed: number; abandoned: number; conversionRate: number | null };
  resources: Array<{
    resourceId: string;
    name: string;
    kind: string;
    bookedMinutes: number;
    capacityMinutes: number | null;
    utilizationRate: number | null;
  }>;
};

export type ReportKind = "sales" | "team" | "clients" | "appointments";
