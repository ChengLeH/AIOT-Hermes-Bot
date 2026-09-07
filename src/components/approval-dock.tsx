import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Square } from "lucide-react";
import { BotAvatar } from "./bot-avatar";
import { ApprovalCardView } from "./approval-card";
import type { ApprovalCard } from "@/lib/approvals";
import { type Locale } from "@/lib/locale";

export type ApprovalDockHandle = { collapse: () => boolean };

export const ApprovalDock = forwardRef<ApprovalDockHandle, {
  name: string; profile: string; swatch: string; working: boolean;
  approvals: ApprovalCard[]; locale: Locale;
  canStop: boolean; stopping: boolean; onStop: () => void;
}>(function ApprovalDock({ name, profile, swatch, working, approvals, locale, canStop, stopping, onStop }, ref) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const before = useRef<DOMRect | null>(null);
  const animation = useRef<Animation | null>(null);
  const ghost = useRef<HTMLElement | null>(null);
  const seenTriggers = useRef(new Set<string>());
  const en = locale === "en";
  const pending = approvals.filter((card) => ["pending", "submitting", "error"].includes(card.status));
  const visible = pending.length > 0;
  const status = en ? "Waiting for approval" : "等待批准";

  function open() {
    if (expanded) return;
    window.history.pushState({ ...window.history.state, aiotView: "chat", aiotApprovalDock: profile }, "");
    setExpanded(true);
  }
  function collapse(fromHistory = false) {
    if (!expanded) return false;
    before.current = cardRef.current?.getBoundingClientRect() ?? null;
    ghost.current?.remove();
    ghost.current = cardRef.current?.cloneNode(true) as HTMLElement | null;
    setExpanded(false);
    if (!fromHistory && window.history.state?.aiotApprovalDock === profile) window.history.back();
    return true;
  }
  useImperativeHandle(ref, () => ({ collapse: () => collapse() }));

  useEffect(() => {
    const trigger = pending.at(-1)?.requestId ?? "";
    if (!trigger && expanded) {
      setExpanded(false);
      if (window.history.state?.aiotApprovalDock === profile) window.history.back();
      return;
    }
    if (trigger && !seenTriggers.current.has(trigger)) {
      seenTriggers.current.add(trigger);
      if (!expanded) {
        window.history.pushState({ ...window.history.state, aiotView: "chat", aiotApprovalDock: profile }, "");
        setExpanded(true);
      }
    }
  }, [working, pending.at(-1)?.requestId, profile, expanded]);

  useEffect(() => {
    const pop = () => { if (window.history.state?.aiotApprovalDock !== profile) collapse(true); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && expanded) { event.preventDefault(); collapse(); } };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("popstate", pop); window.removeEventListener("keydown", key); };
  });

  useLayoutEffect(() => {
    const el = cardRef.current;
    const old = before.current;
    before.current = null;
    if (expanded || !el || !old || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = el.getBoundingClientRect();
    animation.current?.cancel();
    const floating = ghost.current;
    if (!floating) return;
    floating.setAttribute("aria-hidden", "true");
    floating.inert = true;
    Object.assign(floating.style, {
      position: "fixed", top: `${old.top}px`, left: `${old.left}px`, width: `${old.width}px`,
      height: `${old.height}px`, margin: "0", pointerEvents: "none", zIndex: "90", transformOrigin: "top left",
    });
    document.body.appendChild(floating);
    el.style.visibility = "hidden";
    const dx = now.left - old.left;
    const dy = Math.max(0, now.top - old.top);
    const sx = now.width / old.width;
    const sy = now.height / old.height;
    // Preserve the expanded surface while pulling it directly down to its measured dock.
    animation.current = floating.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy * .88})`, offset: .76, opacity: .8 },
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0 },
    ], { duration: 640, easing: "cubic-bezier(.45,0,.8,1)", fill: "forwards" });
    const sourceAvatar = floating.querySelector<HTMLElement>(".approval-mascot");
    const destinationAvatar = el.querySelector<HTMLElement>(".approval-mascot");
    const mascot = sourceAvatar?.cloneNode(true) as HTMLElement | undefined;
    if (sourceAvatar && destinationAvatar && mascot) {
      const start = sourceAvatar.getBoundingClientRect();
      const end = destinationAvatar.getBoundingClientRect();
      sourceAvatar.style.visibility = "hidden";
      Object.assign(mascot.style, { position: "fixed", left: `${start.left}px`, top: `${start.top}px`, zIndex: "91", pointerEvents: "none" });
      mascot.setAttribute("aria-hidden", "true");
      document.body.appendChild(mascot);
      const x = end.left - start.left;
      const y = Math.max(0, end.top - start.top);
      mascot.animate([
        { transform: "translate(0,0) scale(1)" },
        { transform: `translate(${x * .2}px,${y * .3}px) scale(.78,1.45)`, offset: .24 },
        { transform: `translate(${x}px,${y}px) scale(1.25,.65)`, offset: .76 },
        { transform: `translate(${x}px,${y}px) scale(.94,1.08)`, offset: .89 },
        { transform: `translate(${x}px,${y}px) scale(1)` },
      ], { duration: 640, easing: "ease-in" }).finished.then(() => mascot.remove(), () => mascot.remove());
      mascot.querySelector(".aiot-eyes")?.animate([
        { transform: "translateY(-4px) scaleY(1.75)" },
        { transform: "translateY(-4px) scaleY(1.75)", offset: .7 },
        { transform: "translateY(0) scaleY(1)" },
      ], { duration: 640 });
    }
    const finish = () => { floating.remove(); el.style.visibility = ""; };
    animation.current.finished.then(finish, finish);
  }, [expanded]);

  useEffect(() => () => { animation.current?.cancel(); ghost.current?.remove(); }, []);
  if (!visible) return null;
  return (
    <div className="approval-dock-slot" onClick={(event) => event.stopPropagation()}>
      <div ref={cardRef} className={`approval-dock ${expanded ? "approval-dock-expanded" : "approval-dock-compact"} approval-dock-attention`}>
        <button type="button" className="approval-dock-heading" onClick={() => expanded ? collapse() : open()} aria-expanded={expanded} aria-label={`${name} · ${status}`}>
          <span className="approval-mascot"><BotAvatar swatch={swatch} profile={profile} size={38} /></span>
          <span className="approval-dock-label"><strong>{name}</strong><span role="status">{status}</span></span>
          {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        {expanded ? <div className="approval-dock-body">
          {working ? <span className="work-track approval-dock-progress" aria-hidden><i /></span> : null}
          
          {pending.map((card) => <ApprovalCardView key={card.requestId} card={card} locale={locale} swatch={swatch} profile={profile} collapsible={false}
            stopAction={canStop && working ? <button type="button" className="approval-dock-stop stop-btn" onClick={onStop} disabled={stopping}><Square size={11} fill="currentColor" />{stopping ? (en ? "Stopping…" : "正在停止…") : (en ? "Stop task" : "停止工作")}</button> : undefined}
          />)}
        </div> : null}
      </div>
    </div>
  );
});
