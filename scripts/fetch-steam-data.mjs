// One-shot tool: validates appids and fetches real screenshot URLs for every
// entry in games.json via Steam's public appdetails endpoint.
//
// Usage: node scripts/fetch-steam-data.mjs
//
// Steam's screenshot URLs look like:
//   https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{APPID}/ss_{HASH}.116x65.jpg
// We strip the size suffix and store just the {HASH} segment in screenshotIds.
//
// The app builds the runtime URL as
//   https://cdn.cloudflare.steamstatic.com/steam/apps/{APPID}/ss_{HASH}.jpg
// which redirects/serves to the same image at full size.
import fs from 'node:fs/promises';

const path = new URL('../games.json', import.meta.url);
const games = JSON.parse(await fs.readFile(path, 'utf8'));

function extractScreenshotHash(pathThumbnail) {
  // example: https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1086940/ss_abc123.116x65.jpg?t=...
  const m = /\/ss_([a-f0-9]+)\./.exec(pathThumbnail);
  return m ? m[1] : null;
}

async function fetchAppDetails(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,screenshots&l=en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'capsule-rank/1.0 (data fetcher)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${appid}`);
  const json = await res.json();
  const entry = json[String(appid)];
  if (!entry?.success) throw new Error(`appdetails returned success=false for ${appid}`);
  return entry.data;
}

const out = [];
for (const game of games) {
  process.stdout.write(`appid ${game.appid} (${game.name})… `);
  try {
    const data = await fetchAppDetails(game.appid);
    const realName = data.name;
    const shots = (data.screenshots || []).slice(0, 4);
    const ids = shots.map(s => extractScreenshotHash(s.path_thumbnail)).filter(Boolean);
    if (realName.toLowerCase() !== game.name.toLowerCase()) {
      console.log(`NAME MISMATCH — yours="${game.name}" steam="${realName}"`);
    } else {
      console.log(`ok (${ids.length} screenshots)`);
    }
    out.push({ ...game, name: realName, screenshotIds: ids });
  } catch (e) {
    console.log(`FAILED — ${e.message}`);
    out.push(game);
  }
  await new Promise(r => setTimeout(r, 350)); // be polite
}

await fs.writeFile(path, JSON.stringify(out, null, 2) + '\n');
console.log(`\nWrote ${out.length} entries to ${path.pathname}`);
