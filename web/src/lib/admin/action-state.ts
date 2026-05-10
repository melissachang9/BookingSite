/**
 * Shared form state type for Server Actions in admin pages.
 */
export type ActionState = {
  error?: string;
  success?: string;
};

export const initialActionState: ActionState = {};
