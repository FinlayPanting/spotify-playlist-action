// Personal play counts from stats.fm (needs a public profile; counts need stats.fm Plus).
// Returns { bySpotifyId: Map, byName: Map } or null if unavailable. Never throws.

const BASE = 'https://api.stats.fm/api/v1';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'spotify-playlist-action' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function getPlayCounts(user, range, songKey) {
  if (!user) {
    console.log('stats.fm: no STATSFM_USER set, ranking without play counts');
    return null;
  }
  try {
    const bySpotifyId = new Map();
    const byName = new Map();
    const limit = 1000;
    let withCounts = 0, total = 0;
    for (let offset = 0; offset < 20000; offset += limit) {
      const url = `${BASE}/users/${encodeURIComponent(user)}/top/tracks?range=${range}&limit=${limit}&offset=${offset}`;
      const items = (await getJson(url)).items || [];
      for (const it of items) {
        const t = it.track || {};
        // Plus accounts get real stream counts; otherwise fall back to the ranking position
        const plays = typeof it.streams === 'number' ? it.streams : null;
        total++;
        if (plays !== null) withCounts++;
        const entry = { plays, position: it.position };
        for (const id of (t.externalIds && t.externalIds.spotify) || []) bySpotifyId.set(id, entry);
        if (t.name) {
          const k = songKey({ name: t.name, artists: (t.artists || []).map(a => a.name) });
          if (!byName.has(k)) byName.set(k, entry);
        }
      }
      if (items.length < limit) break;
    }
    console.log(`stats.fm: ${total} tracks for ${user} (${range}), ${withCounts} with play counts`);
    return total ? { bySpotifyId, byName, hasCounts: withCounts > 0 } : null;
  } catch (e) {
    console.log(`stats.fm unavailable (${e.message}), ranking without play counts`);
    return null;
  }
}

module.exports = { getPlayCounts };
