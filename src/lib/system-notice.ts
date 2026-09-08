/** Only translate an exact, known upstream status notice; never arbitrary prose. */
export function localizeSystemNotice(text: string, locale: string): string {
  if (locale !== "en" && /^(?:⚡\s*)?Stopped\. You can continue this session\.$/.test(text.trim())) {
    return `${text.trim().startsWith("⚡") ? "⚡ " : ""}已停止，你可以繼續這段對話。`;
  }
  return text;
}
