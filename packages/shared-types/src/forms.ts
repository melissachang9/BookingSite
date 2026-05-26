import type { AuditFields, ISODateString, TenantScoped, UUID } from "./common";

export type FormScope = "customer" | "internal";

export type CustomerPromptTiming = "pre_booking" | "pre_visit" | "post_visit";

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "select"
  | "multi_select"
  | "checkbox"
  | "yes_no"
  | "date"
  | "number"
  | "file_upload"
  | "signature"
  | "section"
  | "static_text";

export type FormFieldOption = {
  label: string;
  value: string;
  helpText?: string;
};

export type FormFieldValidation = {
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
};

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: FormFieldOption[];
  validation?: FormFieldValidation;
  content?: string;
};

export type FormSchema = {
  title: string;
  description?: string;
  fields: FormField[];
};

export type FormSummary = AuditFields &
  TenantScoped & {
    name: string;
    scope: FormScope;
    customerPromptTiming?: CustomerPromptTiming | null;
    isActive: boolean;
    currentVersionId?: UUID | null;
  };

export type FormVersion = AuditFields & {
  formId: UUID;
  versionNumber: number;
  schema: FormSchema;
};

export type ServiceFormAttachment = {
  formId: UUID;
  serviceId: UUID;
  customerPromptTiming: CustomerPromptTiming;
};

export type FormAttachment = {
  id: UUID;
  fieldId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  url: string;
};

export type FormAnswerValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | FormAttachment[];

export type FormAnswers = Record<string, FormAnswerValue>;

export type FormRequirementStatus = "pending" | "satisfied" | "expired" | "waived";

export type FormRequirement = AuditFields & {
  bookingId?: UUID;
  bookingDraftId?: UUID;
  formId: UUID;
  formVersionId: UUID;
  scope: FormScope;
  customerPromptTiming?: CustomerPromptTiming | null;
  status: FormRequirementStatus;
  satisfiedByResponseId?: UUID | null;
  formTitle?: string | null;
  formDescription?: string | null;
  schema?: FormSchema | null;
};

export type FormResponseSummary = AuditFields &
  TenantScoped & {
    formId: UUID;
    formVersionId: UUID;
    customerId: UUID;
    bookingId?: UUID | null;
    bookingDraftId?: UUID | null;
    scope: FormScope;
    customerPromptTiming?: CustomerPromptTiming | null;
    submittedAt: ISODateString;
    filledByUserId?: UUID | null;
    answers: FormAnswers;
    attachments: FormAttachment[];
  };

export type SubmitFormResponseRequest = {
  bookingId?: UUID;
  bookingDraftId?: UUID;
  formVersionId: UUID;
  answers: FormAnswers;
};

export type SubmitFormRequirementRequest = {
  answers: FormAnswers;
};

export type SaveFormDraftRequest = {
  bookingDraftId: UUID;
  formVersionId: UUID;
  answers: FormAnswers;
};