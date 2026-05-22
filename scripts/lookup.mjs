// Resolve Steam titles → appids + metadata, printing JSON snippets ready to
// drop into games.json. Tags are left empty since Steam's appdetails endpoint
// doesn't expose user tags — fill those in by hand.
//
// Usage:
//   node scripts/lookup.mjs "Hollow Knight" "Stardew Valley"
//
// For each query: prints the top 5 storesearch candidates so you can spot
// disambiguation issues, then dumps a full entry for the #1 hit.
const queries = process.argv.slice(2);
if (!queries.length) {
  console.error('usage: node scripts/lookup.mjs "Title 1" "Title 2" ...');
  process.exit(1);
}

const UA = 'capsule-rank/1.0 (data fetcher)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`storesearch HTTP ${r.status}`);
  const j = await r.json();
  return j.items || [];
}

async function appdetails(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,screenshots,platforms,release_date,price_overview&l=en`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`appdetails HTTP ${r.status}`);
  const j = await r.json();
  const e = j[String(appid)];
  if (!e?.success) throw new Error(`appdetails failure for ${appid}`);
  return e.data;
}

async function reviews(appid) {
  const url = `https://store.steampowered.com/appreviews/${appid}?json=1&num_per_page=0&language=all&purchase_type=all`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`reviews HTTP ${r.status}`);
  const j = await r.json();
  return j.query_summary || {};
}

const RX_SS = /\/ss_([a-f0-9]+)\./;
const MONTHS = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };

for (const q of queries) {
  console.log(`\n=== ${q} ===`);
  const items = await search(q);
  if (!items.length) { console.log('no results'); continue; }
  console.log('candidates:');
  for (const it of items.slice(0, 5)) console.log(`  ${it.id}  ${it.name}`);
  const pick = items[0];
  await sleep(350);
  const d = await appdetails(pick.id);
  await sleep(350);
  const rv = await reviews(pick.id);
  const shots = (d.screenshots || []).slice(0, 4)
    .map(s => (RX_SS.exec(s.path_thumbnail) || [])[1])
    .filter(Boolean);
  const platforms = Object.entries(d.platforms || {}).filter(([, v]) => v).map(([k]) => k);
  let iso = null;
  const m = /(\d{1,2})\s+([A-Za-z]+),\s+(\d{4})/.exec(d.release_date?.date || '');
  if (m && MONTHS[m[2]]) iso = `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`;
  const cents = d.price_overview?.final ?? (d.is_free ? 0 : null);
  console.log(JSON.stringify({
    appid: pick.id,
    name: d.name,
    tags: [],
    price: cents,
    discountPct: d.price_overview?.discount_percent || undefined,
    reviewSummary: rv.review_score_desc,
    reviewCount: rv.total_reviews,
    screenshotIds: shots,
    platforms,
    releaseDate: iso || d.release_date?.date,
  }, null, 2));
  await sleep(350);
}
