export type AdminRole = "owner" | "manager" | "staff" | "provider" | (string & {});

export function canManageBookingCheckout(role: AdminRole | null | undefined) {
  return role === "owner" || role === "manager" || role === "staff";
}

export function getManageBookingCheckoutError() {
  return "Only owners, managers, and staff can handle booking checkout or payment actions.";
}