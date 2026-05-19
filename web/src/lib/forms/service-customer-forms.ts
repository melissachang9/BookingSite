import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerFormTiming = "pre_booking" | "pre_visit" | "post_visit";

export type ServiceCustomerForm = {
  formId: string;
  formVersionId: string;
  timing: CustomerFormTiming;
  name: string;
  description: string | null;
};

export async function loadServiceCustomerForms(
  admin: ReturnType<typeof createAdminClient>,
  input: { tenantId: string; serviceId: string }
): Promise<ServiceCustomerForm[]> {
  const { data, error } = await admin
    .from("service_forms")
    .select(
      "form_id, forms!inner(id, name, description, current_version_id, is_archived, scope, customer_prompt_timing)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("service_id", input.serviceId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => {
      const form = row.forms as
        | {
            id: string;
            name: string;
            description: string | null;
            current_version_id: string | null;
            is_archived: boolean;
            scope: string;
            customer_prompt_timing: CustomerFormTiming | null;
          }
        | {
            id: string;
            name: string;
            description: string | null;
            current_version_id: string | null;
            is_archived: boolean;
            scope: string;
            customer_prompt_timing: CustomerFormTiming | null;
          }[]
        | null;
      const normalizedForm = Array.isArray(form) ? form[0] : form;

      if (
        !normalizedForm ||
        normalizedForm.scope !== "customer" ||
        normalizedForm.is_archived ||
        !normalizedForm.current_version_id
      ) {
        return null;
      }

      return {
        formId: normalizedForm.id,
        formVersionId: normalizedForm.current_version_id,
        timing: normalizedForm.customer_prompt_timing ?? "pre_booking",
        name: normalizedForm.name,
        description: normalizedForm.description ?? null,
      } satisfies ServiceCustomerForm;
    })
    .filter((form): form is ServiceCustomerForm => form !== null);
}

export function filterServiceCustomerFormsByTiming(
  forms: ServiceCustomerForm[],
  timing: CustomerFormTiming | CustomerFormTiming[]
) {
  const timings = new Set(Array.isArray(timing) ? timing : [timing]);
  return forms.filter((form) => timings.has(form.timing));
}

export function toBookingFormRequirementRows(
  forms: Pick<ServiceCustomerForm, "formId" | "formVersionId">[],
  input:
    | { tenantId: string; bookingDraftId: string; bookingId?: never }
    | { tenantId: string; bookingId: string; bookingDraftId?: never }
) {
  return forms.map((form) => ({
    tenant_id: input.tenantId,
    ...(input.bookingDraftId
      ? { booking_draft_id: input.bookingDraftId }
      : { booking_id: input.bookingId }),
    form_id: form.formId,
    form_version_id: form.formVersionId,
  }));
}