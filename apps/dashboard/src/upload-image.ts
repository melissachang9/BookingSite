import { apiBaseUrl } from "./platform-api";

export type UploadedImage = { url: string; fileName: string };

/** Upload an image to the tenant's media store and return its public URL. */
export async function uploadImageFile(tenantSlug: string, file: File): Promise<UploadedImage> {
  const body = new FormData();
  body.append("file", file);
  body.append("tenant_id", tenantSlug);
  const response = await fetch(`${apiBaseUrl}/forms/upload`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    let detail = "Unable to upload image.";
    try {
      const data = (await response.json()) as { detail?: string };
      if (typeof data.detail === "string" && data.detail.trim()) {
        detail = data.detail;
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const data = (await response.json()) as { url?: string; fileName?: string };
  if (!data.url) {
    throw new Error("Upload did not return a URL.");
  }
  return { url: data.url, fileName: data.fileName ?? file.name };
}
