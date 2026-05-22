// Serves the repo over a loopback HTTP server and runs tests.html headlessly.
// Exits 0 only if every assertion in tests.html passes and no console errors fire.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safe === '/' ? 'index.html' : safe);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/tests.html`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: 'load' });
// tests.html appends the summary <h2> after all asserts run on window 'load'.
await page.locator('h2').first().waitFor({ timeout: 10000 });

const { passed, failed, failures } = await page.evaluate(() => {
  const h2 = document.querySelector('h2');
  const m = h2?.textContent.match(/(\d+) passed, (\d+) failed/);
  return {
    passed: m ? parseInt(m[1], 10) : -1,
    failed: m ? parseInt(m[2], 10) : -1,
    failures: Array.from(document.querySelectorAll('.fail')).map(el => el.textContent),
  };
});

await browser.close();
server.close();

console.log(`tests.html: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n--- failures ---');
  for (const f of failures) console.log(f);
}
if (pageErrors.length) {
  console.log('\n--- uncaught errors ---');
  for (const e of pageErrors) console.log(e);
}
if (consoleErrors.length) {
  console.log('\n--- console errors ---');
  for (const e of consoleErrors) console.log(e);
}

const ok = failed === 0 && passed > 0 && pageErrors.length === 0 && consoleErrors.length === 0;
process.exit(ok ? 0 : 1);
