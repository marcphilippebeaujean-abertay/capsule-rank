// Pre-commit gate: ESLint, stylelint, then headless tests.html. Fail fast.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function step(name, cmd, args) {
  console.log(`\n→ ${name}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`\n✗ ${name} failed (exit ${r.status}). Aborting commit.`);
    process.exit(r.status || 1);
  }
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
step('eslint', npx, ['eslint', 'app.js', 'scripts']);
step('stylelint', npx, ['stylelint', 'style.css']);
step('tests.html', process.execPath, ['scripts/run-tests.mjs']);

console.log('\n✓ pre-commit checks passed');
