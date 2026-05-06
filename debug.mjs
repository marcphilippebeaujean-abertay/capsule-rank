// Debug harness for capsule-rank.
// Usage:
//   node debug.mjs                        — load app, capture state, screenshot
//   node debug.mjs tests                  — run tests.html and report
//   node debug.mjs --url http://...       — point at a different host
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const mode = args.includes('tests') ? 'tests'
  : args.includes('crop') ? 'crop'
  : args.includes('carousel') ? 'carousel'
  : 'app';
const urlArgIdx = args.indexOf('--url');
const baseUrl = urlArgIdx >= 0 ? args[urlArgIdx + 1] : 'http://localhost:8000';

const url = mode === 'tests' ? `${baseUrl}/tests.html` : `${baseUrl}/`;
const screenshotPath = ({
  tests: 'debug-tests.png',
  crop: 'debug-crop.png',
  carousel: 'debug-carousel.png',
  app: 'debug.png',
})[mode];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', msg => {
  consoleMessages.push({ type: msg.type(), text: msg.text() });
});
page.on('pageerror', err => {
  pageErrors.push(err.message + (err.stack ? '\n' + err.stack : ''));
});
page.on('requestfailed', req => {
  failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
});

console.log(`→ Loading ${url}`);
const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
console.log(`  HTTP ${resp?.status()}`);

// Give Alpine + async init a moment.
await page.waitForTimeout(800);

if (mode === 'carousel') {
  // Wipe IndexedDB and localStorage so the test is reproducible.
  await page.evaluate(() => new Promise(resolve => {
    localStorage.clear();
    const req = indexedDB.deleteDatabase('capsule-rank');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  async function uploadColor(color, label) {
    const dataUrl = await page.evaluate(({ color, label }) => {
      const c = document.createElement('canvas');
      c.width = 460; c.height = 215;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color; ctx.fillRect(0, 0, 460, 215);
      ctx.fillStyle = 'white'; ctx.font = 'bold 100px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 230, 107);
      return c.toDataURL('image/png');
    }, { color, label });
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    await page.locator('.add-thumb input[type="file"]').setInputFiles({
      name: 'test.png', mimeType: 'image/png', buffer: buf,
    });
    await page.locator('.crop-modal').waitFor({ state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: 'Use this crop' }).click();
    await page.locator('.crop-modal').waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(200);
  }

  await uploadColor('#c33', 'A');
  await uploadColor('#3c3', 'B');
  await uploadColor('#36c', 'C');

  const afterUploads = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    return {
      libraryCount: state.capsuleLibrary.length,
      activeId: state.userGame.activeCapsuleId,
      thumbCount: document.querySelectorAll('.capsule-thumb:not(.add-thumb)').length,
    };
  });
  console.log('\n--- after 3 uploads ---');
  console.log(JSON.stringify(afterUploads, null, 2));

  // Click the LAST thumb (oldest, label 'A' — library is sorted newest first, so last is A).
  const thumbs = page.locator('.capsule-thumb:not(.add-thumb)');
  await thumbs.last().click();
  await page.waitForTimeout(400); // exceed persister debounce (250ms)

  const afterSelect = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    return {
      activeId: state.userGame.activeCapsuleId,
      activeMatchesLast: state.userGame.activeCapsuleId === state.capsuleLibrary[state.capsuleLibrary.length - 1].id,
    };
  });
  console.log('\n--- after selecting last (oldest) thumb ---');
  console.log(JSON.stringify(afterSelect, null, 2));

  // Reload and confirm the library survived (IndexedDB) and active selection survived (localStorage).
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    return {
      libraryCount: state.capsuleLibrary.length,
      activeId: state.userGame.activeCapsuleId,
      hasActiveCapsule: !!state.userGame.capsule,
    };
  });
  console.log('\n--- after reload ---');
  console.log(JSON.stringify(afterReload, null, 2));

  // Hover and delete one thumb.
  await thumbs.first().hover();
  await page.waitForTimeout(100);
  await thumbs.first().locator('.remove-x').click();
  await page.waitForTimeout(200);
  const afterDelete = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    return { libraryCount: state.capsuleLibrary.length };
  });
  console.log('\n--- after delete ---');
  console.log(JSON.stringify(afterDelete, null, 2));

  // Click the re-crop icon: opens crop modal pre-loaded with the active record's source.
  const idBeforeRecrop = await page.evaluate(() => document.body._x_dataStack[0].userGame.activeCapsuleId);
  await page.locator('.preview-actions .icon-btn[aria-label="Re-crop"]').click();
  await page.locator('.crop-modal').waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: 'Use this crop' }).click();
  await page.locator('.crop-modal').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(400);
  const afterRecrop = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    return {
      libraryCount: state.capsuleLibrary.length,
      activeId: state.userGame.activeCapsuleId,
    };
  });
  console.log('\n--- after re-crop (should NOT add new entry) ---');
  console.log(JSON.stringify({ ...afterRecrop, idUnchanged: afterRecrop.activeId === idBeforeRecrop }, null, 2));

  // Click the X icon: deselect (does NOT delete from library).
  await page.locator('.preview-actions .icon-btn[aria-label="Deselect"]').click();
  await page.waitForTimeout(150);
  const afterDeselect = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    return {
      libraryCount: state.capsuleLibrary.length,
      activeId: state.userGame.activeCapsuleId,
      capsule: state.userGame.capsule,
    };
  });
  console.log('\n--- after X (deselect, library kept) ---');
  console.log(JSON.stringify({ libraryCount: afterDeselect.libraryCount, activeId: afterDeselect.activeId, capsuleNull: afterDeselect.capsule === null }, null, 2));
} else if (mode === 'crop') {
  // Synthesize a 1200×400 PNG (3:1, wider than 460:215) and drive the file input.
  // Then drag the crop image, apply, and verify userGame.capsule got a 460×215 data URL.
  const fileBuffer = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 400;
    const ctx = canvas.getContext('2d');
    // Left half red, right half blue, with a white "L" on the left and "R" on the right.
    ctx.fillStyle = '#c33'; ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = '#36c'; ctx.fillRect(600, 0, 600, 400);
    ctx.fillStyle = 'white'; ctx.font = 'bold 200px sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('L', 250, 200);
    ctx.fillText('R', 850, 200);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl;
  });
  // Convert data URL to a file via Playwright's input.setInputFiles.
  const base64 = fileBuffer.split(',')[1];
  const fileInput = page.locator('.capsule-slot input[type="file"]');
  await fileInput.setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  });
  // Wait for the crop modal to appear.
  await page.locator('.crop-modal').waitFor({ state: 'visible', timeout: 5000 });
  await page.screenshot({ path: 'debug-crop-before.png' });

  // Drag the image to the right (so the LEFT half of the source ends up in the viewport).
  const stage = page.locator('.crop-stage');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'debug-crop-during.png' });

  // Click "Use this crop"
  await page.getByRole('button', { name: 'Use this crop' }).click();
  await page.locator('.crop-modal').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const state = document.body._x_dataStack[0];
    const capsule = state.userGame.capsule;
    return { hasCapsule: !!capsule, prefix: capsule?.slice(0, 30) };
  });
  console.log('\n--- crop result ---');
  console.log(JSON.stringify(result, null, 2));

  // Verify the rendered capsule matches expected size in DOM.
  const renderedSize = await page.evaluate(() => {
    const img = document.querySelector('.capsule-slot img');
    if (!img) return null;
    return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  });
  console.log('rendered capsule natural size:', JSON.stringify(renderedSize));
} else if (mode === 'tests') {
  // tests.html appends summary like "12 passed, 0 failed"
  const summary = await page.locator('h2').last().textContent().catch(() => null);
  const failItems = await page.locator('.fail').allTextContents();
  console.log('\n--- tests.html summary ---');
  console.log(summary || '(no summary found)');
  if (failItems.length) {
    console.log('\n--- failures ---');
    failItems.forEach(t => console.log(t));
  }
} else {
  // App-mode probe
  const probe = await page.evaluate(() => {
    const out = {
      title: document.title,
      alpinePresent: typeof window.Alpine !== 'undefined',
      capsuleRankFnPresent: typeof window.capsuleRankApp === 'function',
      bodyHasXData: document.body.hasAttribute('x-data'),
      // Alpine attaches the reactive state to the element under _x_dataStack
      bodyAlpineStack: !!document.body._x_dataStack,
    };
    if (document.body._x_dataStack) {
      const state = document.body._x_dataStack[0];
      out.gamesCount = state.games?.length ?? null;
      out.sampledCount = state.sampledGames?.length ?? null;
      out.displayedCount = state.displayedRows?.length ?? null;
      out.activeRowKey = state.activeRowKey ?? null;
      out.userTags = state.userGame?.tags ?? null;
      out.loadError = state.loadError ?? null;
    }
    out.rowCount = document.querySelectorAll('.grid-rows .row').length;
    out.sidebarHasContent = !!document.querySelector('.sidebar-name')?.textContent?.trim();
    return out;
  });
  console.log('\n--- app probe ---');
  console.log(JSON.stringify(probe, null, 2));
}

if (consoleMessages.length) {
  console.log('\n--- browser console ---');
  for (const m of consoleMessages) console.log(`[${m.type}] ${m.text}`);
}
if (pageErrors.length) {
  console.log('\n--- uncaught errors ---');
  for (const e of pageErrors) console.log(e);
}
if (failedRequests.length) {
  console.log('\n--- failed requests ---');
  for (const r of failedRequests) console.log(r);
}

await page.screenshot({ path: screenshotPath, fullPage: true });
console.log(`\n→ Screenshot saved to ${screenshotPath}`);

await browser.close();

const ok = pageErrors.length === 0 && (mode !== 'tests' || !consoleMessages.some(m => m.type === 'error'));
process.exit(ok ? 0 : 1);
