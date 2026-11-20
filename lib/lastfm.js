// Small Last.fm API client: similar artists, similar tracks and artist tags.
// Requests are spaced out, retried on hiccups, and cached in a JSON file so
// repeat runs barely touch the API.

const fs = require('fs');

const BASE = 'https://ws.audioscrobbler.com/2.0/';
const GAP_MS = 250;                       // ~4 requests/second, well under Last.fm's limit
const CACHE_DAYS = 60;                    // similarity and tags change slowly

// Tags that say nothing about how music sounds
const JUNK_TAGS = new Set(['seen live', 'favorites', 'favourite', 'favorite', 'favourites', 'my favorite',
  'love', 'awesome', 'beautiful', 'cool', 'albums i own', 'spotify', 'under 2000 listeners', 'check out']);

const sleep = ms => new Promise(r => setTimeout(r, ms));

class LastFm {
  constructor(apiKey, cacheFile) {
    this.apiKey = apiKey;
    this.cacheFile = cacheFile;
    this.calls = 0;
    this.cache = {};
    try { this.cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { /* first run */ }
    // drop stale entries
    const cutoff = Date.now() - CACHE_DAYS * 86400000;
    for (const [k, v] of Object.entries(this.cache)) if (!v || v.t < cutoff) delete this.cache[k];
  }

  save() {
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache));
  }

  // Cache the trimmed result of fn() under key
  async cached(key, fn) {
    if (this.cache[key]) return this.cache[key].d;
    const d = await fn();
    if (d !== undefined) this.cache[key] = { t: Date.now(), d };
    return d;
  }

  // Raw API call; returns parsed JSON, null if not found, undefined if it failed (not cached)
  async call(method, params) {

    const url = new URL(BASE);
    url.search = new URLSearchParams({ method, ...params, api_key: this.apiKey, format: 'json', autocorrect: '1' });
    const waits = [3000, 15000];
    for (let i = 0; ; i++) {
      await sleep(GAP_MS);
      this.calls++;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'spotify-playlist-action (personal; github.com/FinlayPanting/spotify-playlist-action)' } });
        const body = await res.json().catch(() => ({}));
        if (body.error === 6) return null;   // artist/track not found
        if (!res.ok || body.error) throw new Error(`Last.fm ${res.status} ${body.message || ''}`.trim());
        return body;
      } catch (e) {
        if (i >= waits.length) { console.log(`Last.fm gave up on ${method}: ${e.message}`); return undefined; }
        await sleep(waits[i]);
      }
    }
  }

  // [{ name, match }] with match 0-1
  async similarArtists(artist, limit = 100) {
    return (await this.cached(`sa|${artist.toLowerCase()}`, async () => {
      const d = await this.call('artist.getSimilar', { artist, limit: String(limit) });
      if (d === undefined) return undefined;
      return ((d && d.similarartists && d.similarartists.artist) || [])
        .map(a => ({ name: a.name, match: Math.round((Number(a.match) || 0) * 1000) / 1000 }));
    })) || [];
  }

  // [{ name, artist, match }]
  async similarTracks(artist, track, limit = 50) {
    return (await this.cached(`st|${artist.toLowerCase()}|${track.toLowerCase()}`, async () => {
      const d = await this.call('track.getSimilar', { artist, track, limit: String(limit) });
      if (d === undefined) return undefined;
      return ((d && d.similartracks && d.similartracks.track) || [])
        .map(t => ({ name: t.name, artist: t.artist && t.artist.name, match: Math.round((Number(t.match) || 0) * 1000) / 1000 }));
    })) || [];
  }

  // { tag: weight 0-1 } (top 10 meaningful tags)
  async artistTags(artist) {
    return (await this.cached(`tags|${artist.toLowerCase()}`, async () => {
      const d = await this.call('artist.getTopTags', { artist });
      if (d === undefined) return undefined;
      const tags = ((d && d.toptags && d.toptags.tag) || [])
        .map(t => ({ name: String(t.name).toLowerCase().trim(), count: Number(t.count) || 0 }))
        .filter(t => t.count > 0 && !JUNK_TAGS.has(t.name) && t.name !== String(artist).toLowerCase())
        .slice(0, 10);
      const max = Math.max(1, ...tags.map(t => t.count));
      return Object.fromEntries(tags.map(t => [t.name, Math.round(t.count / max * 100) / 100]));
    })) || {};
  }
}

module.exports = { LastFm };
