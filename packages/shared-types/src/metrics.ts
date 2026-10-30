/**
 * One definition per business metric, so every report, export and screen explains a number the same way.
 * `reported` metrics are computed today (see `where`); `planned` ones are defined here so the data we
 * capture now is the data they will need (see `needs`).
 */
export type MetricDefinition = {
  key: string;
  name: string;
  group: "sales" | "clients" | "acquisition" | "operations";
  /** What it is, in plain words. */
  meaning: string;
  /** How it is calculated. */
  formula: string;
  status: "reported" | "planned";
  /** Where it appears, for reported metrics. */
  where?: string;
  /** What is still missing, for planned metrics. */
  needs?: string;
};

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: "net_sales",
    name: "Net sales",
    group: "sales",
    meaning: "What was sold on visits completed in the period, after discounts.",
    formula: "Service price + add-ons and extra items − discounts. Tax and tips are reported separately. Dated by completion.",
    status: "reported",
    where: "Sales, Overview",
  },
  {
    key: "average_ticket",
    name: "Average ticket",
    group: "sales",
    meaning: "How much a typical completed visit is worth.",
    formula: "Net sales ÷ completed visits.",
    status: "reported",
    where: "Sales, Overview",
  },
  {
    key: "tax_collected",
    name: "Tax collected",
    group: "sales",
    meaning: "Sales tax charged on completed sales.",
    formula: "Sum of tax recorded on each completed sale, at the rate in force when it was made.",
    status: "reported",
    where: "Tax",
  },
  {
    key: "gross_profit",
    name: "Gross profit and margin",
    group: "sales",
    meaning: "What is left of sales after the cost to deliver them.",
    formula:
      "For sale lines with a cost: sales − (cost × quantity). Margin = profit ÷ those sales. Costs are frozen at the time of sale; sales without a cost are left out and shown as coverage. Before discounts; staff pay is not included.",
    status: "reported",
    where: "Sales",
  },
  {
    key: "new_clients",
    name: "New clients",
    group: "clients",
    meaning: "Clients whose first visit falls in the period.",
    formula: "A client's first visit is their earliest non-canceled booking.",
    status: "reported",
    where: "Clients, Overview",
  },
  {
    key: "retention",
    name: "Retention (30/60/90 days)",
    group: "clients",
    meaning: "Share of new clients who book again within the window.",
    formula:
      "Clients first seen in the 12 months before the end date who have another non-canceled booking within N days of their first visit, among those whose N-day window has passed.",
    status: "reported",
    where: "Clients",
  },
  {
    key: "rebooking_rate",
    name: "Rebooking rate",
    group: "clients",
    meaning: "Share of completed visits that were followed by another booking.",
    formula: "Completed visits followed by a later non-canceled booking for the same client ÷ completed visits.",
    status: "reported",
    where: "Clients, Team, Overview",
  },
  {
    key: "lifetime_value",
    name: "Lifetime value (net revenue)",
    group: "clients",
    meaning: "What a paying client has spent with you so far, after refunds.",
    formula:
      "Average of each paying client's succeeded payments, excluding tips and net of refunds. Refunded money is read from the refund events; lifetime value + average refunded = what clients originally paid.",
    status: "reported",
    where: "Clients",
  },
  {
    key: "lifetime_value_profit",
    name: "Lifetime value (gross profit)",
    group: "clients",
    meaning: "What a client has earned you after the cost to deliver their visits.",
    formula: "Sum of each client's sale-line sales − costs, over their lifetime.",
    status: "planned",
    needs: "Costs entered on services and add-ons for enough of your sales.",
  },
  {
    key: "cac",
    name: "Customer acquisition cost (CAC)",
    group: "acquisition",
    meaning: "What it costs to win one new client.",
    formula:
      "Marketing spend on a channel ÷ new clients whose first source was that channel, for the same period. Blended CAC = all spend ÷ all new clients. Spend counts in the range its period starts in.",
    status: "reported",
    where: "Marketing",
  },
  {
    key: "ltv_cac",
    name: "LTV : CAC",
    group: "acquisition",
    meaning: "How many dollars a client returns for each dollar spent winning them. Around 3:1 or better is a common floor.",
    formula: "Gross-profit lifetime value of a channel's clients ÷ that channel's CAC.",
    status: "planned",
    needs: "Several months of attributed clients and costs on your services.",
  },
  {
    key: "payback_period",
    name: "Payback period (30-day cash)",
    group: "acquisition",
    meaning: "How quickly a new client's gross profit repays what it cost to win them. Repaying within 30 days means growth can fund itself.",
    formula: "Gross profit from a cohort's first 30 days ÷ CAC for that cohort.",
    status: "planned",
    needs: "Attributed clients, spend by month, and service costs.",
  },
  {
    key: "online_conversion",
    name: "Online booking conversion",
    group: "acquisition",
    meaning: "Share of online booking carts that became confirmed bookings.",
    formula: "Confirmed ÷ started booking drafts in the period.",
    status: "reported",
    where: "Appointments, Overview",
  },
  {
    key: "funnel_by_source",
    name: "Funnel by source",
    group: "acquisition",
    meaning: "How many visitors from each source reach each step: lead, booked, paid, completed.",
    formula: "Counts of each funnel step by first-touch source.",
    status: "planned",
    needs: "Persisted funnel events (today they are logged, not stored).",
  },
  {
    key: "utilization",
    name: "Utilization",
    group: "operations",
    meaning: "How much of the available working time is booked.",
    formula:
      "Appointment minutes (confirmed + completed, excluding setup and cleanup) ÷ scheduled minutes. Time off and closed days reduce scheduled time.",
    status: "reported",
    where: "Team, Appointments, Overview",
  },
  {
    key: "no_show_rate",
    name: "No-show rate",
    group: "operations",
    meaning: "Share of visits where the client didn't show.",
    formula: "No-shows ÷ (completed + no-shows).",
    status: "reported",
    where: "Appointments, Team, Overview",
  },
  {
    key: "cancel_rate",
    name: "Cancel rate",
    group: "operations",
    meaning: "Share of appointments that were canceled.",
    formula: "Canceled ÷ all appointments in the period. A late cancellation is one inside the business's cancellation window.",
    status: "reported",
    where: "Appointments, Team, Overview",
  },
];
