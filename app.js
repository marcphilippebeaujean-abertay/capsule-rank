// capsule-rank — see docs/superpowers/specs/2026-05-05-capsule-rank-design.md
'use strict';

// ===== Pure helpers (also exposed to tests.html) =====

const STEAM_HEADER_RATIO = 460 / 215; // ≈ 2.1395
const STORAGE_KEY = 'capsuleRank.userGame';

// Steam proxy lives on the kings-path-save-system Firebase project's hosting
// rewrites — see kings-path-server/firebase.json. Override with
// `localStorage.setItem('capsuleRank.steamApi', 'http://localhost:5002')` for
// local-emulator development.
const STEAM_API_DEFAULT = 'https://kings-path-save-system.web.app';

function steamApiBase() {
  try { return localStorage.getItem('capsuleRank.steamApi') || STEAM_API_DEFAULT; }
  catch { return STEAM_API_DEFAULT; }
}

async function steamSearch(query) {
  const q = (query || '').trim();
  if (!q) return { items: [] };
  const url = `${steamApiBase()}/steam/search?q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`steamSearch HTTP ${r.status}`);
  return r.json();
}

async function steamDetails(appid) {
  if (!Number.isInteger(appid) || appid <= 0) throw new Error('invalid appid');
  const url = `${steamApiBase()}/steam/details?appid=${appid}`;
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`steamDetails HTTP ${r.status}`);
  return r.json();
}

function classifyAspectRatio(width, height) {
  if (!width || !height) return 'reject';
  const ratio = width / height;
  const deviation = Math.abs(ratio - STEAM_HEADER_RATIO) / STEAM_HEADER_RATIO;
  if (deviation <= 0.02) return 'ok';
  if (deviation <= 0.10) return 'warn';
  return 'reject';
}

function sampleGames(pool, n) {
  const copy = pool.slice();
  const take = Math.min(n, copy.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, take);
}

function formatPrice(cents, discountPct) {
  if (cents === 0) return { final: 'Free', original: null, discountLabel: null };
  const fmt = c => '$' + (c / 100).toFixed(2);
  if (!discountPct || discountPct <= 0) {
    return { final: fmt(cents), original: null, discountLabel: null };
  }
  const finalCents = Math.round(cents * (100 - discountPct) / 100);
  return {
    final: fmt(finalCents),
    original: fmt(cents),
    discountLabel: '-' + discountPct + '%',
  };
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatReleaseDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (monthIdx < 0 || monthIdx > 11) return '';
  return `${day} ${MONTHS_SHORT[monthIdx]}, ${year}`;
}

function randomTags(games, n) {
  const all = new Set();
  for (const g of games) for (const t of (g.tags || [])) all.add(t);
  return sampleGames(Array.from(all), n);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('not a valid image'));
    img.src = dataUrl;
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not a valid image'));
    img.src = dataUrl;
  });
}

// Largest target-aspect rectangle centered inside the source.
function centerCropRect(srcW, srcH, targetW, targetH) {
  const srcRatio = srcW / srcH;
  const targetRatio = targetW / targetH;
  if (srcRatio > targetRatio) {
    const w = srcH * targetRatio;
    return { x: (srcW - w) / 2, y: 0, width: w, height: srcH };
  }
  const h = srcW / targetRatio;
  return { x: 0, y: (srcH - h) / 2, width: srcW, height: h };
}

// Render a source-rect of an image into a target-sized canvas → data URL.
async function cropToDataURL(dataUrl, srcRect, targetW, targetH, mime = 'image/jpeg', quality = 0.9) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, srcRect.x, srcRect.y, srcRect.width, srcRect.height, 0, 0, targetW, targetH);
  return canvas.toDataURL(mime, quality);
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function capsuleUrl(row) {
  if (row.isUser) return row.capsule;
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${row.appid}/header.jpg`;
}

function screenshotUrl(row, ssid) {
  if (row.isUser) return ssid; // user screenshots are data URLs already
  // Steam's 600x338 variant matches the sidebar display size and is ~10x smaller
  // than the default (full-resolution) variant.
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${row.appid}/ss_${ssid}.600x338.jpg`;
}

function defaultUserGame() {
  return {
    capsule: null,
    activeCapsuleId: null,
    screenshots: [],
    name: '',
    tags: [],
    price: 1199,
    discountPct: 0,
    reviewSummary: 'Very Positive',
    reviewCount: 1234,
    platforms: ['windows'],
    releaseDate: new Date().toISOString().slice(0, 10),
  };
}

// ===== IndexedDB capsule library =====

const DB_NAME = 'capsule-rank';
const DB_VERSION = 1;
const STORE_CAPSULES = 'capsules';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CAPSULES)) {
        db.createObjectStore(STORE_CAPSULES, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAllCapsules() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CAPSULES, 'readonly');
    const req = tx.objectStore(STORE_CAPSULES).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutCapsule(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CAPSULES, 'readwrite');
    tx.objectStore(STORE_CAPSULES).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDeleteCapsule(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CAPSULES, 'readwrite');
    tx.objectStore(STORE_CAPSULES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== Alpine component =====

function capsuleRankApp() {
  return {
    games: [],
    loadError: null,
    userGame: defaultUserGame(),
    capsuleLibrary: [],          // [{ id, dataUrl, createdAt }] hydrated from IndexedDB
    storageWarning: null,
    sampledGames: [],
    userInsertIndex: null,
    activeRowKey: null,

    // Mobile sidebar overlay state.
    isMobile: false,
    mobileSidebarOpen: false,
    mobileSidebarTop: 0,

    // Capsule crop UI state (transient, not persisted).
    cropping: false,
    cropSourceUrl: null,
    cropSourceW: 0,
    cropSourceH: 0,
    cropOffsetX: 0,
    cropOffsetY: 0,
    cropDragStart: null,
    cropEditingId: null,         // when set, applyCrop updates that library record instead of creating a new one
    dragActive: false,           // true while a file is being dragged over the capsule preview

    async init() {
      this.hydrate();
      this.installPersister();
      this.installMobileWatcher();
      this.installPasteHandler();
      try {
        const records = await dbAllCapsules();
        this.capsuleLibrary = records.sort((a, b) => b.createdAt - a.createdAt);
      } catch (e) {
        console.warn('IndexedDB load failed:', e);
      }
      await this.loadGames();
      if (this.userGame.tags.length === 0 && this.games.length > 0) {
        this.userGame.tags = randomTags(this.games, 3);
      }
      this.refresh();
    },

    installMobileWatcher() {
      const mq = window.matchMedia('(max-width: 900px)');
      this.isMobile = mq.matches;
      mq.addEventListener('change', e => {
        this.isMobile = e.matches;
        if (!e.matches) this.mobileSidebarOpen = false;
      });
      // Close the mobile sidebar when the user taps anywhere that's not inside the sidebar
      // and not inside a row. Alpine's @click.outside fires in capture phase and races with
      // the row's @click handler; a plain bubble-phase listener runs *after* row clicks,
      // which lets us cleanly distinguish row taps (handled by onRowClick) from real outside taps.
      document.addEventListener('click', (e) => {
        if (!this.isMobile || !this.mobileSidebarOpen) return;
        if (e.target.closest('.sidebar')) return;
        if (e.target.closest('.row')) return;
        this.mobileSidebarOpen = false;
      });
    },

    installPasteHandler() {
      document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            e.preventDefault();
            this.cropEditingId = null;
            this.loadCapsuleFile(file);
            return;
          }
        }
      });
    },

    onRowClick(rowKey, event) {
      const sameRow = this.activeRowKey === rowKey;
      this.activeRowKey = rowKey;
      if (!this.isMobile) return;
      // Tap the same row again → toggle the overlay closed (clear close gesture).
      if (sameRow && this.mobileSidebarOpen) {
        this.mobileSidebarOpen = false;
        return;
      }
      const rowEl = event.currentTarget;
      this.mobileSidebarTop = rowEl.offsetTop + rowEl.offsetHeight;
      this.mobileSidebarOpen = true;
    },

    hydrate() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        this.userGame = { ...defaultUserGame(), ...saved };
      } catch (e) {
        console.warn('hydrate failed:', e);
      }
    },

    installPersister() {
      const write = debounce(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.userGame));
          this.storageWarning = null;
        } catch (e) {
          this.storageWarning = "Couldn't save — your browser storage is full.";
          console.warn('localStorage write failed:', e);
        }
      }, 250);
      this.$watch('userGame', () => write(), { deep: true });
    },

    async loadGames() {
      try {
        const res = await fetch('games.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this.games = await res.json();
      } catch (e) {
        this.loadError = "Couldn't load comparison games. Check your connection and refresh.";
        console.warn('games.json fetch failed:', e);
      }
    },

    get displayedRows() {
      const rows = this.sampledGames.map(g => ({ ...g, key: 'g' + g.appid, isUser: false }));
      if (this.userInsertIndex !== null && this.userGame.capsule) {
        const u = this.userGame;
        rows.splice(this.userInsertIndex, 0, {
          key: 'user',
          isUser: true,
          capsule: u.capsule,
          name: u.name || 'Untitled',
          tags: u.tags,
          price: u.price,
          discountPct: u.discountPct,
          reviewSummary: u.reviewSummary,
          reviewCount: u.reviewCount,
          platforms: u.platforms,
          releaseDate: u.releaseDate,
          screenshotIds: u.screenshots,
        });
      }
      return rows;
    },

    get activeRow() {
      return this.displayedRows.find(r => r.key === this.activeRowKey) || this.displayedRows[0] || null;
    },

    refresh() {
      const hasUser = !!this.userGame.capsule;
      const sampleSize = hasUser ? 9 : 10;
      this.sampledGames = sampleGames(this.games, sampleSize);
      this.userInsertIndex = hasUser ? Math.floor(Math.random() * 10) : null;
      this.activeRowKey = this.displayedRows[0]?.key ?? null;
      this.mobileSidebarOpen = false;
    },

    priceFor(row) { return formatPrice(row.price ?? 1199, row.discountPct ?? 0); },
    dateFor(row) { return formatReleaseDate(row.releaseDate); },
    capsuleUrl(row) { return capsuleUrl(row); },
    screenshotsFor(row) {
      const ids = row.screenshotIds || [];
      return ids.map((id, i) => ({ key: row.key + '-ss-' + i, src: screenshotUrl(row, id) }));
    },

    async loadCapsuleFile(file) {
      if (!file || !file.type?.startsWith('image/')) return;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const { width, height } = await imageDimensions(dataUrl);
        this.cropSourceUrl = dataUrl;
        this.cropSourceW = width;
        this.cropSourceH = height;
        const slack = this.cropSlack(width, height);
        this.cropOffsetX = -slack.x / 2;
        this.cropOffsetY = -slack.y / 2;
        this.cropping = true;
      } catch (e) {
        console.warn('invalid capsule upload:', e);
      }
    },

    async onCapsuleSelected(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      await this.loadCapsuleFile(file);
    },

    async onCapsuleDropped(event) {
      this.dragActive = false;
      const file = event.dataTransfer?.files?.[0];
      await this.loadCapsuleFile(file);
    },

    // Internal helper: returns { displayW, displayH, scale, x: slackX, y: slackY } for given source dims.
    cropMetrics(srcW, srcH) {
      const VW = 460, VH = 215;
      const scale = Math.max(VW / srcW, VH / srcH);
      const displayW = srcW * scale;
      const displayH = srcH * scale;
      return { displayW, displayH, scale, slackX: displayW - VW, slackY: displayH - VH };
    },

    cropSlack(srcW, srcH) {
      const m = this.cropMetrics(srcW, srcH);
      return { x: m.slackX, y: m.slackY };
    },

    get cropDisplayW() { return this.cropMetrics(this.cropSourceW, this.cropSourceH).displayW; },
    get cropDisplayH() { return this.cropMetrics(this.cropSourceW, this.cropSourceH).displayH; },

    startCrop(event) {
      this.cropDragStart = {
        x: event.clientX,
        y: event.clientY,
        ox: this.cropOffsetX,
        oy: this.cropOffsetY,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },

    dragCrop(event) {
      if (!this.cropDragStart) return;
      const m = this.cropMetrics(this.cropSourceW, this.cropSourceH);
      const dx = event.clientX - this.cropDragStart.x;
      const dy = event.clientY - this.cropDragStart.y;
      this.cropOffsetX = Math.min(0, Math.max(-m.slackX, this.cropDragStart.ox + dx));
      this.cropOffsetY = Math.min(0, Math.max(-m.slackY, this.cropDragStart.oy + dy));
    },

    endCrop() { this.cropDragStart = null; },

    cancelCrop() {
      this.cropping = false;
      this.cropSourceUrl = null;
      this.cropDragStart = null;
      this.cropEditingId = null;
    },

    async applyCrop() {
      const m = this.cropMetrics(this.cropSourceW, this.cropSourceH);
      const sx = -this.cropOffsetX / m.scale;
      const sy = -this.cropOffsetY / m.scale;
      const sw = 460 / m.scale;
      const sh = 215 / m.scale;
      try {
        const cropped = await cropToDataURL(this.cropSourceUrl, { x: sx, y: sy, width: sw, height: sh }, 460, 215);

        if (this.cropEditingId) {
          const idx = this.capsuleLibrary.findIndex(c => c.id === this.cropEditingId);
          if (idx >= 0) {
            const updated = {
              ...this.capsuleLibrary[idx],
              dataUrl: cropped,
              cropOffsetX: this.cropOffsetX,
              cropOffsetY: this.cropOffsetY,
            };
            try { await dbPutCapsule(updated); } catch (e) { console.warn('IndexedDB write failed:', e); }
            this.capsuleLibrary = [
              ...this.capsuleLibrary.slice(0, idx),
              updated,
              ...this.capsuleLibrary.slice(idx + 1),
            ];
            if (this.userGame.activeCapsuleId === this.cropEditingId) {
              this.userGame.capsule = cropped;
            }
          }
        } else {
          const record = {
            id: newId(),
            dataUrl: cropped,
            sourceDataUrl: this.cropSourceUrl,
            sourceW: this.cropSourceW,
            sourceH: this.cropSourceH,
            cropOffsetX: this.cropOffsetX,
            cropOffsetY: this.cropOffsetY,
            createdAt: Date.now(),
          };
          try { await dbPutCapsule(record); } catch (e) { console.warn('IndexedDB write failed:', e); }
          this.capsuleLibrary = [record, ...this.capsuleLibrary];
          const wasAbsent = !this.userGame.capsule;
          this.userGame.capsule = cropped;
          this.userGame.activeCapsuleId = record.id;
          if (wasAbsent) this.refresh();
        }

        this.cropping = false;
        this.cropSourceUrl = null;
        this.cropEditingId = null;
      } catch (e) {
        console.warn('crop failed:', e);
      }
    },

    async recropActive() {
      const record = this.capsuleLibrary.find(c => c.id === this.userGame.activeCapsuleId);
      if (!record) return;
      // Prefer the original source (preserves slack to drag); fall back to the cropped image
      // for legacy records that pre-date sourceDataUrl support.
      const sourceUrl = record.sourceDataUrl || record.dataUrl;
      let sourceW = record.sourceW, sourceH = record.sourceH;
      if (!sourceW || !sourceH) {
        try { ({ width: sourceW, height: sourceH } = await imageDimensions(sourceUrl)); }
        catch (e) { console.warn('recrop: cannot read image dimensions', e); return; }
      }
      this.cropSourceUrl = sourceUrl;
      this.cropSourceW = sourceW;
      this.cropSourceH = sourceH;
      const m = this.cropMetrics(sourceW, sourceH);
      this.cropOffsetX = record.cropOffsetX ?? -m.slackX / 2;
      this.cropOffsetY = record.cropOffsetY ?? -m.slackY / 2;
      this.cropEditingId = record.id;
      this.cropping = true;
    },

    selectCapsule(record) {
      this.userGame.capsule = record.dataUrl;
      this.userGame.activeCapsuleId = record.id;
    },

    async deleteCapsule(record) {
      try {
        await dbDeleteCapsule(record.id);
      } catch (e) {
        console.warn('IndexedDB delete failed:', e);
      }
      this.capsuleLibrary = this.capsuleLibrary.filter(c => c.id !== record.id);
      if (this.userGame.activeCapsuleId === record.id) {
        this.userGame.capsule = null;
        this.userGame.activeCapsuleId = null;
        this.refresh();
      }
    },

    clearCapsule() {
      this.userGame.capsule = null;
      this.userGame.activeCapsuleId = null;
      this.refresh();
    },

    async onScreenshotSelected(event, slotIndex) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const { width, height } = await imageDimensions(dataUrl);
        // Center-crop to 16:9, capped at 1280×720 to keep localStorage small.
        const TARGET_W = 1280, TARGET_H = 720;
        const rect = centerCropRect(width, height, TARGET_W, TARGET_H);
        const outW = Math.min(rect.width, TARGET_W);
        const outH = Math.round(outW * (TARGET_H / TARGET_W));
        const cropped = await cropToDataURL(dataUrl, rect, outW, outH);
        const next = this.userGame.screenshots.slice();
        next[slotIndex] = cropped;
        this.userGame.screenshots = next.filter(Boolean);
      } catch (e) {
        console.warn('invalid screenshot upload:', e);
      }
    },

    removeScreenshot(slotIndex) {
      const next = this.userGame.screenshots.slice();
      next.splice(slotIndex, 1);
      this.userGame.screenshots = next;
    },

    addTag(value) {
      const tag = (value || '').trim();
      if (!tag) return;
      if (this.userGame.tags.includes(tag)) return;
      this.userGame.tags = [...this.userGame.tags, tag];
    },

    removeTag(tag) {
      this.userGame.tags = this.userGame.tags.filter(t => t !== tag);
    },

    togglePlatform(platform) {
      const set = new Set(this.userGame.platforms);
      set.has(platform) ? set.delete(platform) : set.add(platform);
      this.userGame.platforms = Array.from(set);
    },

    clearAll() {
      this.userGame = defaultUserGame();
      this.capsuleWarning = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      if (this.games.length > 0) {
        this.userGame.tags = randomTags(this.games, 3);
      }
      this.refresh();
    },

    onCapsuleImageError(row) {
      if (row.isUser) return;
      const usedIds = new Set(this.sampledGames.map(g => g.appid));
      const unused = this.games.filter(g => !usedIds.has(g.appid) && g.appid !== row.appid);
      const replacement = sampleGames(unused, 1)[0];
      const idx = this.sampledGames.findIndex(g => g.appid === row.appid);
      if (idx === -1) return;
      if (replacement) {
        this.sampledGames.splice(idx, 1, replacement);
      } else {
        this.sampledGames.splice(idx, 1);
      }
      if (this.activeRowKey === 'g' + row.appid) {
        this.activeRowKey = this.displayedRows[0]?.key ?? null;
      }
      console.warn('swapped out broken capsule for appid', row.appid);
    },
  };
}

document.addEventListener('alpine:init', () => {
  Alpine.data('capsuleRankApp', capsuleRankApp);
});
