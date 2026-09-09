import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AiotHead } from "./bot-avatar";

/** Keep the outcome pending while the photo picker or another app is visible. */
export function UploadFeedback({ ok, locale, onDismiss }: {
  ok: boolean;
  locale: string;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => dismiss.current(), 2800);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return createPortal(
    <div role="status" className="upload-feedback">
      <span className={ok ? "upload-success-mascot" : "upload-error-mascot"}>
        <AiotHead eye={ok ? "#91b69c" : "#bd777c"} className="size-12" />
      </span>
      <span>{locale === "en" ? (ok ? "Upload complete" : "Upload failed") : (ok ? "上傳成功" : "上傳失敗")}</span>
    </div>, document.body,
  );
}
