import { useState, type ReactNode } from "react";
import { Download, FileText } from "lucide-react";
import { highlightPieces } from "./chat-search";
import { codeTokens } from "./code-highlight";
import { t, type Locale } from "./locale";
import { remoteAssetFromUrl } from "./session-output-media";

export function Markdown({
  text,
  query = "",
  locale,
}: {
  text: string;
  query?: string;
  locale?: Locale | null;
}) {
  const blocks = splitBlocks(text);
  return (
    <div className="md-bubble">
      {blocks.map((b, i) => {
        if (b.type === "code") {
          return <CodeBlock key={i} text={b.text} lang={b.lang} query={query} locale={locale} />;
        }
        if (b.type === "ul") {
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, query, locale)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, query, locale)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "h") {
          return (
            <p key={i} className={`md-h md-h${b.level}`}>
              {inline(b.text, query, locale)}
            </p>
          );
        }
        return (
          <p key={i} className="md-p">
            {inline(b.text, query, locale)}
          </p>
        );
      })}
    </div>
  );
}

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; text: string; lang: string };

function fenceLanguage(header: string): string {
  return header.replace(/^```/, "").trim().split(/\s+/)[0] ?? "";
}

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const lang = fenceLanguage(line);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]?.startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      out.push({ type: "code", text: body.join("\n"), lang });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      out.push({ type: "h", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      out.push({ type: "ol", items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(```|#+\s|[-*]\s|\d+\.\s)/.test(lines[i] ?? "")) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    out.push({ type: "p", text: para.join("\n") });
  }
  return out.length ? out : [{ type: "p", text: src }];
}

function mark(text: string, query: string, key: string): ReactNode {
  const pieces = highlightPieces(text, query);
  if (pieces.length === 1 && !pieces[0]?.hit) return text;
  return pieces.map((piece, i) =>
    piece.hit ? (
      <mark key={`${key}-${i}`} className="chat-hit">
        {piece.text}
      </mark>
    ) : (
      <span key={`${key}-${i}`}>{piece.text}</span>
    ),
  );
}

function RemoteResultAsset({ value, locale }: { value: string; locale?: Locale | null }) {
  const asset = remoteAssetFromUrl(value);
  if (!asset) return null;
  if (asset.kind === "image") {
    return (
      <span className="remote-result-asset file-card">
        <img src={asset.url} alt={asset.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        <a href={asset.url} download={asset.name} target="_blank" rel="noreferrer noopener" referrerPolicy="no-referrer">
          <Download className="size-3" />
          {t(locale, "chat.download")}
        </a>
      </span>
    );
  }
  return (
    <a className="remote-result-file file-card" href={asset.url} download={asset.name} target="_blank" rel="noreferrer noopener" referrerPolicy="no-referrer">
      <FileText className="size-4" />
      <span>{asset.name}</span>
      <Download className="size-3" />
    </a>
  );
}

function inline(src: string, query = "", locale?: Locale | null): ReactNode[] {
  const tokens = src.split(/(!\[[^\]]*\]\(https?:[^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]+)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return <strong key={i}>{mark(tok.slice(2, -2), query, `b${i}`)}</strong>;
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return <code key={i}>{mark(tok.slice(1, -1), query, `c${i}`)}</code>;
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
      return <em key={i}>{mark(tok.slice(1, -1), query, `e${i}`)}</em>;
    }
    const image = /^!\[[^\]]*\]\((https?:[^)]+)\)$/.exec(tok);
    if (image) {
      const asset = remoteAssetFromUrl(image[1]);
      if (asset?.kind === "image") return <RemoteResultAsset key={i} value={image[1]} locale={locale} />;
    }
    const link = /^\[([^\]]+)\]\((https?:[^)]+)\)$/.exec(tok);
    if (link) {
      return (
        <a key={i} href={link[1] ? link[2] : "#"} target="_blank" rel="noreferrer noopener">
          {mark(link[1], query, `a${i}`)}
        </a>
      );
    }
    const asset = remoteAssetFromUrl(tok);
    if (asset) return <RemoteResultAsset key={i} value={tok} locale={locale} />;
    return <span key={i}>{mark(tok, query, `t${i}`)}</span>;
  });
}

export function CodeBlock({
  text,
  lang,
  query = "",
  locale,
  label: heading,
}: {
  text: string;
  lang: string;
  query?: string;
  locale?: Locale | null;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const label = heading || lang || t(locale, "chat.code");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="md-code-lang">{label}</span>
        <button type="button" className="md-code-copy" onClick={() => void copy()} aria-label={t(locale, "chat.copy")}>
          {copied ? t(locale, "chat.copied") : t(locale, "chat.copy")}
        </button>
      </div>
      <pre>
        <code>
          {codeTokens(text, lang).map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>
              {mark(token.text, query, `code-${index}`)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
