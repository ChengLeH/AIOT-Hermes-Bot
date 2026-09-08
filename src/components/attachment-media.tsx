import { useEffect, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import type { AttachmentDescriptor } from "@/lib/attachment-rules";
import {
  createPreviewUrl,
  fetchedImageUrl,
  formatFileSize,
  isImageAttachment,
  rememberFetchedImage,
  sessionImageUrl,
  type QueuedAttachment,
} from "@/lib/attachment-preview";
import { getBotAttachment } from "@/lib/native-bot";
import { t, type Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function QueuePreview({
  item,
  onRemove,
  locale,
}: {
  item: QueuedAttachment;
  onRemove: () => void;
  locale: Locale;
}) {
  const image = Boolean(item.previewUrl) && isImageAttachment({ mime: item.mime, name: item.name });
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-xl",
        item.status === "error" ? "bg-danger/15" : "bg-bg-elevated",
      )}
    >
      {image ? (
        <img src={item.previewUrl} alt={item.name} className="h-20 w-20 object-cover" />
      ) : (
        <div className="flex max-w-40 flex-col px-2.5 py-2">
          <span className="truncate text-xs text-fg">{item.name}</span>
          <span className="text-[0.65rem] text-subtle">
            {item.status === "uploading"
              ? t(locale, "chat.uploading")
              : item.error || formatFileSize(item.size)}
          </span>
        </div>
      )}
      {item.status === "uploading" && image ? (
        <span className="absolute inset-x-0 bottom-0 bg-bg/70 px-1 py-0.5 text-center text-[0.6rem] text-muted">
          {t(locale, "chat.uploading")}
        </span>
      ) : null}
      {item.status === "error" && image && <span role="alert" className="absolute inset-x-0 bottom-0 bg-bg/90 px-1 py-1 text-center text-[0.65rem] text-danger">{item.error || t(locale, "error.uploadFail")}</span>}
      <button
        type="button"
        aria-label={t(locale, "chat.remove")}
        onClick={onRemove}
        className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-bg/80 text-fg"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

export function MessageAttachments({
  attachments,
  origin,
  apiKey,
  locale,
  align,
}: {
  attachments: AttachmentDescriptor[];
  origin: string;
  apiKey: string;
  locale: Locale;
  align: "start" | "end";
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", align === "end" ? "justify-end" : "justify-start")}>
      {attachments.map((item) => (
        <RemoteAttachment key={item.id} item={item} origin={origin} apiKey={apiKey} locale={locale} />
      ))}
    </ul>
  );
}

function RemoteAttachment({
  item,
  origin,
  apiKey,
  locale,
}: {
  item: AttachmentDescriptor;
  origin: string;
  apiKey: string;
  locale: Locale;
}) {
  const local = origin && apiKey ? sessionImageUrl(item.id) || fetchedImageUrl(item.id) : undefined;
  const [url, setUrl] = useState(local);
  const [busy, setBusy] = useState(false);
  const image = isImageAttachment(item);

  useEffect(() => {
    setUrl(undefined);
    if (!origin || !apiKey || !item.id) return;
    const cached = sessionImageUrl(item.id) || fetchedImageUrl(item.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    if (!origin || !apiKey || !item.id) return;
    let cancelled = false;
    setBusy(true);
    void getBotAttachment({ origin, apiKey, id: item.id })
      .then(({ blob, mime }) => {
        if (cancelled) return;
        const created = createPreviewUrl(blob, { name: item.name, type: mime || item.mime });
        const href = created || (typeof URL !== "undefined" ? URL.createObjectURL(blob) : undefined);
        if (href) {
          rememberFetchedImage(item.id, href);
          setUrl(href);
        }
      })
      .catch(() => {
        if (!cancelled) setUrl(undefined);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.name, item.mime, origin, apiKey, image]);

  const meta = [item.mime, formatFileSize(item.size)].filter(Boolean).join(" · ");

  if (image && url) {
    return (
      <li className="file-card overflow-hidden rounded-xl bg-bg-elevated">
        <img src={url} alt={item.name} className="max-h-48 max-w-48 object-cover" />
        <a
          href={url}
          download={item.name}
          className="flex items-center gap-1 px-2 py-1.5 text-[0.65rem] text-muted"
        >
          <Download className="size-3" />
          {t(locale, "chat.download")}
        </a>
      </li>
    );
  }

  return (
    <li className="file-card flex max-w-52 min-w-36 flex-col rounded-xl bg-bg-elevated px-2.5 py-2">
      <span className="flex items-center gap-1.5">
        <FileText className="size-3.5 shrink-0 text-muted" />
        <span className="truncate text-xs text-fg">{item.name}</span>
      </span>
      <span className="mt-0.5 truncate text-[0.65rem] text-subtle">{meta || (busy ? t(locale, "chat.uploading") : "")}</span>
      {url ? (
        <a
          href={url}
          download={item.name}
          className="mt-1 inline-flex items-center gap-1 text-[0.65rem] text-muted underline-offset-2 hover:underline"
        >
          <Download className="size-3" />
          {t(locale, "chat.download")}
        </a>
      ) : (
        <span className="mt-1 text-[0.65rem] text-subtle">{busy ? t(locale, "chat.uploading") : null}</span>
      )}
    </li>
  );
}
