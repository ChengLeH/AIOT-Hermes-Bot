import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

export function npmCliCandidates(input = {}) {
  const execPath = input.execPath || process.execPath;
  const env = input.env || process.env;
  const candidates = [];
  if (env.npm_execpath) candidates.push(resolve(env.npm_execpath));
  const bin = dirname(execPath);
  candidates.push(
    resolve(bin, "node_modules/npm/bin/npm-cli.js"),
    resolve(bin, "../lib/node_modules/npm/bin/npm-cli.js"),
    resolve(bin, "../node_modules/npm/bin/npm-cli.js"),
  );
  for (const entry of String(env.PATH || "").split(delimiter).filter(Boolean)) {
    candidates.push(resolve(entry, "node_modules/npm/bin/npm-cli.js"));
    for (const name of ["npm", "npm.cmd"]) {
      try {
        const target = realpathSync(resolve(entry, name));
        if (target.endsWith("npm-cli.js")) candidates.push(target);
      } catch { /* candidate is absent */ }
    }
  }
  return [...new Set(candidates)];
}

export function resolveNpmCli(input = {}) {
  const exists = input.exists || existsSync;
  const candidate = npmCliCandidates(input).find((path) => path.endsWith("npm-cli.js") && exists(path));
  if (!candidate) throw new Error("npm CLI was not found. Reinstall Node.js from https://nodejs.org/en/download");
  return candidate;
}

export function npmInvocation(args, input = {}) {
  return { command: input.execPath || process.execPath, args: [resolveNpmCli(input), ...args] };
}
