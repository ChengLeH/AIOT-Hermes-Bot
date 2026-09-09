export function applicationServerKeyMatches(
  actual: ArrayBuffer | null | undefined,
  expected: Uint8Array,
): boolean {
  if (!actual) return false;
  const current = new Uint8Array(actual);
  return current.length === expected.length && current.every((value, index) => value === expected[index]);
}
