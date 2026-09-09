import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { backgroundThemeError, getBackgroundThemeSnapshot, loadBackgroundTheme, prepareBackgroundImage, removeBackgroundTheme, savePreparedBackgroundTheme, subscribeBackgroundTheme, type BackgroundTheme } from "@/lib/background-theme";
import type { Locale } from "@/lib/locale";

export function BackgroundSettings({ locale }: { locale: Locale }) {
  const en = locale === "en"; const input = useRef<HTMLInputElement>(null);
  const [theme,setTheme]=useState(getBackgroundThemeSnapshot()); const [candidate,setCandidate]=useState<BackgroundTheme|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  useEffect(()=>{const unsubscribe=subscribeBackgroundTheme(()=>setTheme(getBackgroundThemeSnapshot()));void loadBackgroundTheme().catch(err=>setError(backgroundThemeError(err,locale)));return unsubscribe;},[locale]);
  async function choose(file:File|null){if(!file)return;setBusy(true);setError("");try{setCandidate(await prepareBackgroundImage(file));}catch(err){setCandidate(null);setError(backgroundThemeError(err,locale));}finally{setBusy(false);}}
  async function apply(){if(!candidate)return;setBusy(true);setError("");try{await savePreparedBackgroundTheme(candidate);setCandidate(null);}catch(err){setError(backgroundThemeError(err,locale));}finally{setBusy(false);}}
  async function remove(){setBusy(true);setError("");try{await removeBackgroundTheme();setCandidate(null);}catch(err){setError(backgroundThemeError(err,locale));}finally{setBusy(false);}}
  return <section className="mt-4 rounded-2xl border border-border bg-bg-elevated p-4">
    <h2 className="text-sm font-medium">{en?"App background":"應用程式背景"}</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted">{en?"Customize the whole app. The image is stored securely on this device only. PNG, JPEG, or WebP; up to 5 MB. Large images are resized automatically.":"自訂整個應用程式的背景。圖片只會安全儲存在這台裝置。支援 PNG、JPEG、WebP，最大 5 MB；大圖會自動縮小。"}</p>
    {(candidate?.dataUrl||theme?.dataUrl)&&<div className="mt-3 h-28 overflow-hidden rounded-xl bg-black"><img src={candidate?.dataUrl||theme?.dataUrl} alt={en?"Background preview":"背景預覽"} className="wallpaper-preview-image size-full object-cover" /></div>}
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>{void choose(event.target.files?.[0]??null);event.target.value="";}} />
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={()=>input.current?.click()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm disabled:opacity-40"><ImagePlus className="size-4" />{en?"Choose image":"選擇圖片"}</button>
      {candidate&&<button type="button" disabled={busy} onClick={()=>void apply()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm text-accent-fg disabled:opacity-40">{busy?<Loader2 className="size-4 animate-spin"/>:null}{en?"Apply":"套用"}</button>}
      {theme&&!candidate&&<button type="button" disabled={busy} onClick={()=>void remove()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm text-muted disabled:opacity-40"><Trash2 className="size-4" />{en?"Remove":"移除"}</button>}
    </div>
    {error&&<p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
  </section>;
}
