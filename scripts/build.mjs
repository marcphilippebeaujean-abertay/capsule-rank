// Minifying production build → dist/.
// Run by GitHub Actions on deploy; safe to run locally too (`npm run build`).
import { mkdir, readFile, writeFile, copyFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { minify as minifyHtml } from 'html-minifier-terser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

await esbuild({
  entryPoints: [path.join(ROOT, 'app.js')],
  outfile: path.join(DIST, 'app.js'),
  bundle: false,
  minify: true,
  sourcemap: true,
  target: ['chrome92', 'safari15.4', 'firefox95', 'edge92'],
  legalComments: 'none',
});

await esbuild({
  entryPoints: [path.join(ROOT, 'style.css')],
  outfile: path.join(DIST, 'style.css'),
  bundle: false,
  minify: true,
  target: ['chrome92', 'safari15.4', 'firefox95', 'edge92'],
  legalComments: 'none',
  loader: { '.css': 'css' },
});

const minCss = await readFile(path.join(DIST, 'style.css'), 'utf8');
const htmlSrc = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const linkRe = /<link\s+rel="stylesheet"\s+href="style\.css"\s*>/;
if (!linkRe.test(htmlSrc)) {
  throw new Error('build: could not find <link rel="stylesheet" href="style.css"> in index.html');
}
const html = htmlSrc.replace(linkRe, `<style>${minCss}</style>`);
const minHtml = await minifyHtml(html, {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
});
await writeFile(path.join(DIST, 'index.html'), minHtml);

for (const file of ['games.json', 'favicon.svg', 'windows.png', 'mac.png']) {
  await copyFile(path.join(ROOT, file), path.join(DIST, file));
}

const cssInSize = (await readFile(path.join(ROOT, 'style.css'))).length;
const cssOutSize = minCss.length;
console.log(`style.css  ${cssInSize} → ${cssOutSize} bytes (${((1 - cssOutSize / cssInSize) * 100).toFixed(1)}% smaller, inlined into index.html)`);
await unlink(path.join(DIST, 'style.css'));

for (const file of ['app.js', 'index.html']) {
  const inSize = (await readFile(path.join(ROOT, file))).length;
  const outSize = (await readFile(path.join(DIST, file))).length;
  const pct = ((1 - outSize / inSize) * 100).toFixed(1);
  console.log(`${file.padEnd(10)} ${inSize} → ${outSize} bytes (${pct}% smaller)`);
}
console.log(`built → ${path.relative(ROOT, DIST)}/`);
