import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function usesTraditionalChinese(): boolean {
  return typeof navigator !== "undefined" && /^zh(?:-|$)/i.test(navigator.language);
}

function errorMessage(error: unknown, chinese: boolean): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return chinese ? "發生未預期的錯誤，請重新開啟頁面。" : "Something unexpected happened. Reopen the page.";
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const chinese = usesTraditionalChinese();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">{chinese ? "出了一點問題" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm break-words text-muted">{errorMessage(error, chinese)}</p>
    </main>
  );
}
