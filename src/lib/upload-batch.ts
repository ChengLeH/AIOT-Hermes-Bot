/** One outcome for a picker batch: wait for every file; any failure makes the batch fail. */
export function createUploadBatch(total: number) {
  let remaining = total;
  let failed = false;
  let notified = false;
  return (ok: boolean): "success" | "failure" | null => {
    if (remaining <= 0) return null;
    remaining--;
    if (!ok) failed = true;
    if (notified || remaining > 0) return null;
    if (failed) { notified = true; return "failure"; }
    if (remaining === 0) { notified = true; return "success"; }
    return null;
  };
}
