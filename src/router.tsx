import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // This client has one document route. Bot/task panels own browser history
  // (including native Back); do not let those state-only changes also reload
  // the document router. Preserve initial queries for setup and task deep links.
  const history = typeof window === "undefined" ? undefined : createMemoryHistory({
    initialEntries: [window.location.pathname + window.location.search],
  });
  return createRouter({ routeTree, history, defaultErrorComponent: AppErrorComponent });
}
