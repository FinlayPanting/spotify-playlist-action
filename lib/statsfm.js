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
    const limit = 500;                      // stats.fm returns at most 500 per request
    let withCounts = 0, total = 0;
    const seenPositions = new Set();
    for (let offset = 0; offset < 20000; offset += limit) {
      const url = `${BASE}/users/${encodeURIComponent(user)}/top/tracks?range=${range}&limit=${limit}&offset=${offset}`;
      let items;
      try {
        items = (await getJson(url)).items || [];
      } catch (e) {
        if (offset === 0) throw e;            // first page failing = no data
        console.log(`stats.fm: stopped at offset ${offset} (${e.message.split(' for ')[0]})`);
        break;                                 // later pages failing = reached the API's limit
      }
      // Stop if the API ignores offset and sends the same page again
      if (items.length === 0 || seenPositions.has(items[0].position)) break;
      for (const it of items) {
        seenPositions.add(it.position);
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
    }
    console.log(`stats.fm: ${total} tracks for ${user} (${range}), ${withCounts} with play counts`);
    return total ? { bySpotifyId, byName, hasCounts: withCounts > 0 } : null;
  } catch (e) {
    console.log(`stats.fm unavailable (${e.message}), ranking without play counts`);
    return null;
  }
}

module.exports = { getPlayCounts };
