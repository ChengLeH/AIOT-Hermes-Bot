import type { ButtonHTMLAttributes } from "react";
import { LoaderCircle, Paperclip, SendHorizontal } from "lucide-react";

const composerButtonBase = "grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-xl transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent";

export function ComposerAttachmentButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${composerButtonBase} bg-bg-elevated text-fg hover:bg-bg-hover disabled:hover:bg-bg-elevated ${props.className ?? ""}`}><Paperclip className="size-4" aria-hidden="true" /></button>;
}

export function ComposerSendButton({ loading = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return <button type="submit" {...props} className={`${composerButtonBase} bg-accent text-accent-fg enabled:hover:brightness-110 ${props.className ?? ""}`}>{loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <SendHorizontal className="size-4" aria-hidden="true" />}</button>;
}
