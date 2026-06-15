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

export type FormSummaryResponse = AuditFields &
  TenantScoped & {
    name: string;
    scope: FormScope;
    customerPromptTiming?: CustomerPromptTiming | null;
    reviewRequired: boolean;
    isActive: boolean;
    currentVersionId?: UUID | null;
    currentVersionNumber?: number | null;
    schema?: FormSchema | null;
    serviceIds: UUID[];
  };

export type FormListResponse = {
  items: FormSummaryResponse[];
};

export type CreateFormRequest = {
  name: string;
  scope?: FormScope;
  customerPromptTiming?: CustomerPromptTiming | null;
  reviewRequired?: boolean;
  schema?: FormSchema;
  serviceIds?: UUID[];
};

export type UpdateFormRequest = {
  name?: string;
  scope?: FormScope;
  customerPromptTiming?: CustomerPromptTiming | null;
  reviewRequired?: boolean;
  isActive?: boolean;
  schema?: FormSchema;
  serviceIds?: UUID[];
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
export type BookingFormResponseEntry = {
  id: UUID;
  formId: UUID;
  formVersionId: UUID;
  formName: string;
  formVersionNumber: number;
  scope: FormScope;
  customerPromptTiming?: CustomerPromptTiming | null;
  submittedAt: ISODateString;
  answers: FormAnswers;
  schema?: FormSchema | null;
  attachments?: FormAttachment[];
};

export type BookingFormResponseList = {
  items: BookingFormResponseEntry[];
};

export type BookingFormRequirementSummary = {
  id: UUID;
  formId: UUID;
  formName: string;
  formDescription?: string | null;
  scope: FormScope;
  customerPromptTiming?: CustomerPromptTiming | null;
  status: FormRequirementStatus;
  schema?: FormSchema | null;
};

export type BookingFormRequirementEntry = {
  id: UUID;
  formId: UUID;
  formVersionId: UUID;
  formName: string;
  formDescription?: string | null;
  scope: FormScope;
  customerPromptTiming?: CustomerPromptTiming | null;
  status: FormRequirementStatus;
  satisfiedByResponseId?: UUID | null;
  schema?: FormSchema | null;
};

export type BookingFormRequirementList = {
  items: BookingFormRequirementEntry[];
};

export type SendFormReminderResponse = {
  bookingId: UUID;
  pendingRequirementCount: number;
  recipientEmail: string;
  provider: string;
  providerMessageId: string;
  sentAt: ISODateString;
  manageUrl: string;
};
