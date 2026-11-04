import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientPhoto, ClientPhotoKind } from "@booking/shared-types";

import { platformApi } from "./platform-api";

type Props = {
  tenantSlug: string;
  customerId: string;
  canView: boolean;
  canManage: boolean;
  /** When set (from an appointment), new photos are tied to that visit. */
  bookingId?: string | null;
};

type Filter = string;

const BUILT_IN_KINDS = ["before", "after", "other"] as const;
const BUILT_IN_LABELS: Record<string, string> = { before: "Before", after: "After", other: "Other" };
const MAX_KIND_LENGTH = 40;

const kindLabel = (kind: ClientPhotoKind): string => BUILT_IN_LABELS[kind] ?? kind;

/** Collapses spaces and matches the spelling of an existing category that differs only by case. */
function cleanKind(raw: string, known: string[]): string {
  const cleaned = raw.split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_KIND_LENGTH);
  const lower = cleaned.toLowerCase();
  if (BUILT_IN_LABELS[lower]) return lower;
  return known.find((entry) => entry.toLowerCase() === lower) ?? cleaned;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Loads a private photo with the staff member's login and returns a temporary local URL for <img>. */
function usePhotoUrl(tenantSlug: string, customerId: string, photoId: string): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, failed: false });
    platformApi
      .getClientPhotoFile(tenantSlug, customerId, photoId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url: objectUrl, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, failed: true });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [tenantSlug, customerId, photoId]);
  return state;
}

function TypeChips({
  value,
  onChange,
  disabled,
  custom,
  onCreate,
}: {
  value: ClientPhotoKind;
  onChange: (kind: ClientPhotoKind) => void;
  disabled?: boolean;
  /** Categories the business has made up. */
  custom: string[];
  /** Called with a new category name so every chip row shows it. */
  onCreate: (kind: ClientPhotoKind) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const kind = cleanKind(draft, custom);
    setAdding(false);
    setDraft("");
    if (!kind) return;
    onCreate(kind);
    onChange(kind);
  };

  const chip = (kind: ClientPhotoKind) => (
    <button
      key={kind}
      type="button"
      role="radio"
      aria-checked={value === kind}
      disabled={disabled}
      className={`cs-photos__chip${value === kind ? " is-active" : ""}`}
      onClick={() => onChange(kind)}
    >
      {kindLabel(kind)}
    </button>
  );

  return (
    <div className="cs-photos__types" role="radiogroup" aria-label="Photo type">
      {BUILT_IN_KINDS.map(chip)}
      {custom.map(chip)}
      {adding ? (
        <input
          className="cs-photos__chip cs-photos__chip--input"
          type="text"
          autoFocus
          aria-label="New category name"
          maxLength={MAX_KIND_LENGTH}
          value={draft}
          placeholder="Category name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft("");
              setAdding(false);
            }
          }}
        />
      ) : (
        <button type="button" className="cs-photos__chip cs-photos__chip--add" disabled={disabled} onClick={() => setAdding(true)}>
          + Add category
        </button>
      )}
    </div>
  );
}

export function ClientPhotos({ tenantSlug, customerId, canView, canManage, bookingId }: Props) {
  const [photos, setPhotos] = useState<ClientPhoto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [savedKinds, setSavedKinds] = useState<string[]>([]);
  // Categories typed in this session that no photo uses yet.
  const [newKinds, setNewKinds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const [response, categories] = await Promise.all([
        platformApi.listClientPhotos(tenantSlug, customerId),
        platformApi.listPhotoCategories(tenantSlug).catch(() => ({ custom: [] as string[] })),
      ]);
      setPhotos(response.items);
      setSavedKinds(categories.custom);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error, "Unable to load photos."));
    }
  }, [canView, tenantSlug, customerId]);

  useEffect(() => {
    setPhotos(null);
    setOpenId(null);
    void load();
  }, [load]);

  if (!canView) {
    return <p className="cs-empty">You don’t have permission to view client photos.</p>;
  }

  const customKinds = Array.from(
    new Map(
      [...savedKinds, ...(photos ?? []).map((photo) => photo.kind), ...newKinds]
        .filter((kind) => !BUILT_IN_LABELS[kind])
        .map((kind) => [kind.toLowerCase(), kind] as const),
    ).values(),
  ).sort((a, b) => a.localeCompare(b));
  const addKind = (kind: ClientPhotoKind) => {
    if (!BUILT_IN_LABELS[kind]) setNewKinds((previous) => (previous.includes(kind) ? previous : [...previous, kind]));
  };
  const filters: Filter[] = ["all", ...BUILT_IN_KINDS, ...customKinds];

  const visible = (photos ?? []).filter((photo) => filter === "all" || photo.kind === filter);
  const opened = photos?.find((photo) => photo.id === openId) ?? null;

  return (
    <div className="cs-photos">
      {canManage ? <PhotoUploader
          tenantSlug={tenantSlug}
          customerId={customerId}
          bookingId={bookingId}
          customKinds={customKinds}
          onCreateKind={addKind}
          onUploaded={load}
        /> : null}

      {loadError ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {loadError}
        </div>
      ) : photos === null ? (
        <p className="cs-empty">Loading photos…</p>
      ) : photos.length === 0 ? (
        <p className="cs-empty">No photos yet.{canManage ? " Add before and after photos above." : ""}</p>
      ) : (
        <>
          <div className="cs-photos__filters" role="group" aria-label="Filter photos">
            {filters.map((entry) => {
              const count = entry === "all" ? photos.length : photos.filter((photo) => photo.kind === entry).length;
              return (
                <button
                  key={entry}
                  type="button"
                  className={`cs-photos__chip${filter === entry ? " is-active" : ""}`}
                  aria-pressed={filter === entry}
                  onClick={() => setFilter(entry)}
                >
                  {entry === "all" ? "All" : kindLabel(entry)} ({count})
                </button>
              );
            })}
          </div>
          {visible.length === 0 ? (
            <p className="cs-empty">No {filter === "all" ? "" : kindLabel(filter).toLowerCase() + " "}photos.</p>
          ) : (
            <ul className="cs-photos__grid">
              {visible.map((photo) => (
                <li key={photo.id}>
                  <PhotoThumb tenantSlug={tenantSlug} customerId={customerId} photo={photo} onOpen={() => setOpenId(photo.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {opened ? (
        <PhotoViewer
          tenantSlug={tenantSlug}
          customerId={customerId}
          photo={opened}
          canManage={canManage}
          customKinds={customKinds}
          onCreateKind={addKind}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}

function PhotoThumb({
  tenantSlug,
  customerId,
  photo,
  onOpen,
}: {
  tenantSlug: string;
  customerId: string;
  photo: ClientPhoto;
  onOpen: () => void;
}) {
  const { url, failed } = usePhotoUrl(tenantSlug, customerId, photo.id);
  const label = `${kindLabel(photo.kind)} photo${photo.caption ? `: ${photo.caption}` : ""}`;
  return (
    <button type="button" className="cs-photos__thumb" onClick={onOpen} aria-label={`Open ${label}`}>
      {url ? <img src={url} alt={label} /> : <span className="cs-photos__placeholder">{failed ? "Can’t load" : "Loading…"}</span>}
      <span className="cs-photos__badge">{kindLabel(photo.kind)}</span>
    </button>
  );
}

function PhotoUploader({
  tenantSlug,
  customerId,
  bookingId,
  customKinds,
  onCreateKind,
  onUploaded,
}: {
  tenantSlug: string;
  customerId: string;
  bookingId?: string | null;
  customKinds: string[];
  onCreateKind: (kind: ClientPhotoKind) => void;
  onUploaded: () => Promise<void>;
}) {
  // Files wait here after they are picked so the type and caption can be set; nothing uploads until Upload.
  const [pending, setPending] = useState<File[]>([]);
  const [kind, setKind] = useState<ClientPhotoKind>("before");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (picked: FileList | null) => {
    // Copy first: the browser empties a FileList when the input is cleared.
    const files = picked ? Array.from(picked) : [];
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;
    setPending(files);
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    setPending([]);
    setCaption("");
    setError(null);
  };

  const upload = async () => {
    setBusy(true);
    setError(null);
    const failures: File[] = [];
    const messages: string[] = [];
    for (const file of pending) {
      try {
        await platformApi.uploadClientPhoto(tenantSlug, customerId, file, {
          kind,
          caption: caption.trim() || undefined,
          bookingId: bookingId ?? undefined,
        });
      } catch (caught) {
        failures.push(file);
        messages.push(`${file.name}: ${errorText(caught, "Upload failed.")}`);
      }
    }
    const added = pending.length - failures.length;
    if (added > 0) {
      setNotice(`Added ${added} photo${added === 1 ? "" : "s"}.`);
      await onUploaded();
    }
    // Only the files that failed stay in the form so they can be retried.
    setPending(failures);
    if (failures.length === 0) setCaption("");
    if (messages.length > 0) setError(messages.join(" "));
    setBusy(false);
  };

  return (
    <div className="cs-photos__uploader">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        hidden
        data-testid="photo-file-input"
        onChange={(event) => pick(event.target.files)}
      />
      {pending.length === 0 ? (
        <div className="cs-photos__uploader-idle">
          <button type="button" className="cs-btn cs-btn--sm cs-btn--primary" onClick={() => inputRef.current?.click()}>
            Add photos
          </button>
          {notice ? (
            <span className="cs-photos__notice" role="status">
              {notice}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="cs-photos__pending">
          <p className="cs-photos__pending-files">
            {pending.length === 1 ? pending[0].name : `${pending.length} photos selected`}
          </p>
          <TypeChips value={kind} onChange={setKind} disabled={busy} custom={customKinds} onCreate={onCreateKind} />
          <textarea
            className="cs-input cs-photos__notes"
            aria-label="Notes"
            rows={2}
            maxLength={1000}
            value={caption}
            disabled={busy}
            placeholder="Notes (optional)"
            onChange={(event) => setCaption(event.target.value)}
          />
          <div className="cs-photos__pending-actions">
            <button type="button" className="cs-btn cs-btn--sm" disabled={busy} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="cs-btn cs-btn--sm cs-btn--primary" disabled={busy} onClick={() => void upload()}>
              {busy ? "Uploading…" : pending.length === 1 ? "Upload photo" : `Upload ${pending.length} photos`}
            </button>
          </div>
        </div>
      )}
      {error ? (
        <div className="cs-banner cs-banner--error cs-photos__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function PhotoViewer({
  tenantSlug,
  customerId,
  photo,
  canManage,
  customKinds,
  onCreateKind,
  onClose,
  onChanged,
}: {
  tenantSlug: string;
  customerId: string;
  photo: ClientPhoto;
  canManage: boolean;
  customKinds: string[];
  onCreateKind: (kind: ClientPhotoKind) => void;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { url, failed } = usePhotoUrl(tenantSlug, customerId, photo.id);
  const [kind, setKind] = useState<ClientPhotoKind>(photo.kind);
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty = kind !== photo.kind || caption.trim() !== (photo.caption ?? "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformApi.updateClientPhoto(tenantSlug, customerId, photo.id, { kind, caption: caption.trim() });
      onClose();
      await onChanged();
    } catch (caught) {
      setError(errorText(caught, "Unable to save changes."));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await platformApi.deleteClientPhoto(tenantSlug, customerId, photo.id);
      onClose();
      await onChanged();
    } catch (caught) {
      setError(errorText(caught, "Unable to remove this photo."));
      setBusy(false);
    }
  };

  return (
    <div className="cs-photos__overlay" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="cs-photos__viewer">
        <header className="cs-photos__viewer-head">
          <span>
            {kindLabel(photo.kind)} · {dateFormatter.format(new Date(photo.createdAt))}
            {photo.uploadedByName ? ` · ${photo.uploadedByName}` : ""}
          </span>
          <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onClose} aria-label="Close photo">
            ×
          </button>
        </header>
        <div className="cs-photos__stage">
          {url ? <img src={url} alt={photo.caption ?? `${kindLabel(photo.kind)} photo`} /> : <p className="cs-empty">{failed ? "Can’t load this photo." : "Loading…"}</p>}
        </div>
        {canManage ? (
          <div className="cs-photos__edit">
            <TypeChips value={kind} onChange={setKind} disabled={busy} custom={customKinds} onCreate={onCreateKind} />
            <textarea
              className="cs-input cs-photos__notes"
              aria-label="Notes"
              rows={3}
              maxLength={1000}
              value={caption}
              disabled={busy}
              placeholder="Notes (optional)"
              onChange={(event) => setCaption(event.target.value)}
            />
            <div className="cs-photos__pending-actions">
              <button type="button" className="cs-btn cs-btn--sm cs-btn--primary" disabled={busy || !dirty} onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        ) : photo.caption ? (
          <p className="cs-photos__caption">{photo.caption}</p>
        ) : null}
        {error ? (
          <div className="cs-banner cs-banner--error" role="alert">
            {error}
          </div>
        ) : null}
        {canManage ? (
          <footer className="cs-photos__viewer-foot">
            {confirmingDelete ? (
              <>
                <span>Remove this photo from the client’s profile?</span>
                <button type="button" className="cs-btn cs-btn--sm" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  Keep
                </button>
                <button type="button" className="cs-btn cs-btn--sm cs-btn--primary" disabled={busy} onClick={() => void remove()}>
                  Remove photo
                </button>
              </>
            ) : (
              <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setConfirmingDelete(true)}>
                Remove photo
              </button>
            )}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
