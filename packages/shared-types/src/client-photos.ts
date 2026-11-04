import type { ISODateString, UUID } from "./common";

/** "before", "after" or "other", or a category the business made up (up to 40 characters). */
export type ClientPhotoKind = string;

export type ClientPhotoCategories = {
  /** Categories the business has made up, beyond Before / After / Other. */
  custom: string[];
};

export type ClientPhoto = {
  id: UUID;
  customerId: UUID;
  bookingId?: UUID | null;
  kind: ClientPhotoKind;
  caption?: string | null;
  mimeType: string;
  fileSizeBytes: number;
  originalFileName?: string | null;
  uploadedByName?: string | null;
  createdAt: ISODateString;
};

export type ClientPhotoList = {
  items: ClientPhoto[];
};

export type UpdateClientPhotoRequest = {
  kind?: ClientPhotoKind;
  /** An empty string clears the caption. */
  caption?: string;
};
