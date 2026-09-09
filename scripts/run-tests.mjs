import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selection = process.argv[2] || 'all';
if (!['all', 'frontend', 'backend'].includes(selection) || process.argv.length > 3) {
  console.error('Usage: node scripts/run-tests.mjs [frontend|backend]');
  process.exit(1);
}
const suites = [
  { name: 'frontend', directory: 'src/lib', suffix: '.test.ts' },
  { name: 'backend', directory: 'scripts', suffix: '.test.mjs' },
];
const files = suites.filter(suite => selection === 'all' || suite.name === selection).flatMap(suite => {
  const matches = readdirSync(resolve(root, suite.directory), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(suite.suffix))
    .map(entry => resolve(root, suite.directory, entry.name)).sort();
  if (!matches.length) throw new Error(`No ${suite.name} tests found`);
  return matches;
});
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...files], {
  cwd: root, stdio: 'inherit', shell: false,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
