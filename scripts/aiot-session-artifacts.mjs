import { basename } from 'node:path';

const PRODUCER = /(?:^|_)(?:creat(?:e|ion)|download|export|generat(?:e|ion)|render|save|speech|tts|write)(?:_|$)/i;
const STRONG_KEY = /^(?:artifact_(?:file|image|path|url)|files?_(?:created|modified|written)|generated_(?:file|image|path|url)|output_(?:file|path|url)|result_(?:file|path|url)|saved_to|screenshot_path)$/i;
const PRODUCER_KEY = /^(?:artifact(?:s|_(?:file|image|path|url))?|attachment(?:s|_(?:file|image|path|url))?|download(?:s|_(?:file|path|url))?|(?:audio|image|video)(?:_(?:file|path|url))?|file_path|local_path|media(?:_(?:file|path|url))?|path)$/i;
const EXT_MIME = new Map(Object.entries({
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp',
  pdf:'application/pdf', txt:'text/plain', md:'text/markdown', json:'application/json', csv:'text/csv',
  doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip:'application/zip',
}));

function unwrap(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = text.match(/^<untrusted_tool_result\b[^>]*>\s*([\s\S]*?)<\/untrusted_tool_result>\s*$/i);
  const candidate = match ? (match[1].includes('\n\n') ? match[1].slice(match[1].indexOf('\n\n') + 2) : match[1]).trim() : text;
  try { return candidate ? JSON.parse(candidate) : null; } catch { return null; }
}

function localFile(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/[),.;]+$/, '');
  if (!path || path.length > 4096 || /[\0\r\n]/.test(path) || /^(?:https?:|data:|file:)/i.test(path)) return null;
  if (!/^(?:\/|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(path)) return null;
  const name = basename(path.replace(/\\/g, '/'));
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const mime = EXT_MIME.get(ext);
  if (!mime || !name || name.length > 240 || name === '.' || name === '..') return null;
  return { path, name, mime };
}

function collect(value, keyPath, producer, out, depth = 0) {
  if (depth > 12 || out.length >= 50) return;
  if (typeof value === 'string') {
    const segments = keyPath.split('.').filter(segment => segment && !/^\d+$/.test(segment));
    if (!segments.some(segment => STRONG_KEY.test(segment) || (producer && PRODUCER_KEY.test(segment)))) return;
    const artifact = localFile(value);
    if (artifact) out.push(artifact);
    return;
  }
  if (Array.isArray(value)) return value.slice(0, 100).forEach((child, index) => collect(child, `${keyPath}.${index}`, producer, out, depth + 1));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value).slice(0, 100)) collect(child, keyPath ? `${keyPath}.${key}` : key, producer, out, depth + 1);
}

export function collectToolArtifacts(messages) {
  if (!Array.isArray(messages)) return [];
  const found = new Map();
  for (const message of messages.slice(-2000)) {
    if (!message || message.role !== 'tool') continue;
    const name = String(message.tool_name || message.name || '').trim().toLowerCase();
    const producer = PRODUCER.test(name) || name.startsWith('bfl_flux3_');
    const payloads = [];
    const parsed = unwrap(message.content ?? message.text ?? message.context);
    if (parsed !== null) payloads.push(parsed);
    if (message.content && typeof message.content === 'object') {
      payloads.push(message.content._multimodal === true ? message.content.meta : message.content);
    }
    const rows = [];
    for (const payload of payloads) collect(payload, 'tool_result', producer, rows);
    for (const row of rows) if (!found.has(row.path)) found.set(row.path, row);
  }
  return [...found.values()];
}

export function artifactMimeForName(name) {
  if (typeof name !== 'string') return null;
  return EXT_MIME.get(name.split('.').pop()?.toLowerCase() || '') || null;
}
