import type { FormField, FormSchema } from "@/lib/forms/schema";

export type FormTemplate = {
  slug: string;
  name: string;
  description: string;
  summary: string;
  schema: FormSchema;
};

function field(field: FormField): FormField {
  return field;
}

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    slug: "generic-intake",
    name: "Generic Intake",
    summary: "Core contact, health, and consent questions for most services.",
    description:
      "A flexible intake form covering goals, relevant medical context, contraindications, and a final consent signature.",
    schema: {
      fields: [
        field({ id: "intro", type: "static_text", label: "", required: false, body: "Please complete this form before your appointment. Your answers help us provide a safe, personalized service." }),
        field({ id: "about-you", type: "section", label: "About you", required: false, body: "Basic intake and treatment planning." }),
        field({ id: "goal", type: "long_text", label: "What are your goals for this appointment?", required: true, help_text: "Tell us what you want to improve or any concerns you want addressed." }),
        field({ id: "allergies", type: "long_text", label: "Allergies or sensitivities", required: false }),
        field({ id: "conditions", type: "multi_select", label: "Relevant conditions", required: false, options: ["Pregnant or nursing", "Diabetes", "Autoimmune condition", "Blood thinner use", "Recent surgery", "None of the above"] }),
        field({ id: "retinol", type: "yes_no", label: "Have you used retinol, tretinoin, or strong exfoliants in the last 7 days?", required: true }),
        field({ id: "pain-level", type: "number", label: "Preferred numbing strength (1-10)", required: false, min: 1, max: 10 }),
        field({ id: "skin-type", type: "select", label: "How would you describe your skin?", required: true, options: ["Dry", "Oily", "Combination", "Sensitive", "Not sure"] }),
        field({ id: "reference-photo", type: "file_upload", label: "Upload a reference photo (optional)", required: false, help_text: "You can upload inspiration or an area-of-concern photo.", upload_kind: "photo", max_files: 5 }),
        field({ id: "consent", type: "checkbox", label: "I confirm my answers are accurate and I consent to treatment planning based on this form.", required: true }),
        field({ id: "signature-section", type: "section", label: "Signature", required: false, body: "Please sign to acknowledge your answers and consent." }),
        field({ id: "signature", type: "signature", label: "Client signature", required: true }),
      ],
    },
  },
  {
    slug: "photo-consent",
    name: "Photo Consent",
    summary: "Consent and release for treatment photos and marketing usage.",
    description:
      "Use when capturing before-and-after imagery. Includes scope of consent, revocation expectations, and signature.",
    schema: {
      fields: [
        field({ id: "intro", type: "static_text", label: "", required: false, body: "We may take photos before, during, or after treatment for documentation, education, or marketing. Please review and choose your preferences below." }),
        field({ id: "photo-types", type: "multi_select", label: "I consent to the studio using my photos for:", required: true, options: ["Internal charting only", "Private staff training", "Social media", "Website / portfolio", "Printed marketing materials"] }),
        field({ id: "identity", type: "yes_no", label: "May your full face be shown in marketing materials?", required: true }),
        field({ id: "tagging", type: "yes_no", label: "May the studio tag or name you publicly?", required: true }),
        field({ id: "restrictions", type: "long_text", label: "Any restrictions or notes about how photos may be used?", required: false }),
        field({ id: "example-photo", type: "file_upload", label: "Optional: upload a reference photo showing the area you are comfortable sharing", required: false, upload_kind: "photo", max_files: 5 }),
        field({ id: "acknowledgement", type: "checkbox", label: "I understand I can revoke future marketing use in writing, but previously published materials may not be retractable immediately.", required: true }),
        field({ id: "signature", type: "signature", label: "Client signature", required: true }),
      ],
    },
  },
  {
    slug: "microneedling",
    name: "Microneedling Medical History",
    summary: "A treatment-specific medical history template for microneedling and similar advanced services.",
    description:
      "Includes contraindications, recent treatments, medications, Fitzpatrick-style context, aftercare readiness, and signature.",
    schema: {
      fields: [
        field({ id: "medical", type: "section", label: "Medical history", required: false, body: "Please answer carefully. Certain answers may require us to reschedule or modify treatment." }),
        field({ id: "contraindications", type: "multi_select", label: "Select any that apply", required: true, options: ["Active acne breakout", "Cold sores / herpes simplex", "Accutane in the last 12 months", "Keloid scarring history", "Active skin infection", "Open wounds", "Blood thinning medication", "None of the above"] }),
        field({ id: "recent-procedures", type: "long_text", label: "Recent procedures, peels, lasers, fillers, or injectables", required: false, help_text: "Include dates if known." }),
        field({ id: "fitzpatrick", type: "select", label: "How does your skin usually respond to sun exposure?", required: true, options: ["Always burns, never tans", "Usually burns, tans minimally", "Sometimes mild burn, gradually tans", "Rarely burns, tans easily", "Very rarely burns, tans deeply", "Never burns"] }),
        field({ id: "isotretinoin", type: "yes_no", label: "Have you taken isotretinoin / Accutane within the last 12 months?", required: true }),
        field({ id: "anticoagulants", type: "yes_no", label: "Are you currently taking anticoagulants or prescription blood thinners?", required: true }),
        field({ id: "pain-medication", type: "yes_no", label: "Have you taken aspirin, ibuprofen, or naproxen in the last 24 hours?", required: true }),
        field({ id: "aftercare", type: "checkbox", label: "I understand I must follow aftercare instructions and avoid sun, intense workouts, and active skincare as directed.", required: true }),
        field({ id: "condition-photo", type: "file_upload", label: "Upload a current skin photo (optional)", required: false, upload_kind: "photo", max_files: 5 }),
        field({ id: "signature", type: "signature", label: "Client signature", required: true }),
      ],
    },
  },
];

export function getFormTemplate(slug: string | undefined) {
  if (!slug) return null;
  return FORM_TEMPLATES.find((template) => template.slug === slug) ?? null;
}