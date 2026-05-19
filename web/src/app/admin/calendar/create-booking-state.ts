import type { ActionState } from "@/lib/admin/action-state";

export type CreateCalendarBookingState = ActionState & {
  createdBookingId?: string;
  createdDraftId?: string;
  checkoutUrl?: string;
};