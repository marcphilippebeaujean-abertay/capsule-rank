# capsule-rank

Drop your Steam header-capsule art into a faithful mock of Steam's "New & Trending"
widget alongside popular games, and see whether it stands out from the crowd.

## Run

It's a static site. Open `index.html` in a browser, or serve the directory with
any static server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(A static server is recommended over `file://` because some browsers restrict
`fetch()` of local files.)

## Tests

Open `tests.html` in a browser. Assertions for the pure helpers
(`classifyAspectRatio`, `sampleGames`, `formatPrice`, `formatReleaseDate`,
`randomTags`) run on page load.

## Adding games to `games.json`

Each entry needs:

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `appid` | number | yes | Steam app id; used to build CDN image URLs |
| `name` | string | yes | |
| `tags` | string[] | yes | Shown as plain text in the row, as pills in the sidebar |
| `reviewSummary` | string | yes | e.g. "Very Positive" |
| `reviewCount` | number | yes | |
| `screenshotIds` | string[] | yes | Each id is appended to `ss_{ID}.jpg` on Steam's CDN |
| `platforms` | string[] | yes | Subset of `windows`, `mac`, `linux` |
| `releaseDate` | string | yes | ISO `YYYY-MM-DD` |
| `price` | number | no | In cents. Defaults to `1199` ($11.99) |
| `discountPct` | number | no | `0`–`95`. Defaults to `0` |

Capsule and screenshot images are loaded directly from Steam's CDN by appid —
no need to host them yourself.
