// Personal play counts from stats.fm (needs a public profile; counts need stats.fm Plus).
// Returns { bySpotifyId: Map, byName: Map } or null if unavailable. Never throws.

const BASE = 'https://api.stats.fm/api/v1';

class HttpError extends Error {}

// Retry network hiccups a couple of times (5s, then 20s) before giving up
async function getJsonWithRetry(url) {
  const waits = [5000, 20000];
  for (let i = 0; ; i++) {
    try {
      return await getJson(url);
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;   // a real "no", not a hiccup
      if (i >= waits.length) throw e;
      console.log(`stats.fm: ${e.message.split(' for ')[0]}, retrying in ${waits[i] / 1000}s`);
      await new Promise(r => setTimeout(r, waits[i]));
    }
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: {
    'User-Agent': 'spotify-playlist-action (personal weekly playlist; github.com/FinlayPanting/spotify-playlist-action)'
  } });
  if (!res.ok) {
    const err = new HttpError(`${res.status} ${res.statusText} for ${url}`);
    err.status = res.status;
    throw err;
  }
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
        items = (await getJsonWithRetry(url)).items || [];
      } catch (e) {
        // A 400 on a later page means we've reached the API's limit (10,000 tracks): that's the end.
        // Anything else means the data is incomplete, so don't use it.
        if (offset > 0 && e instanceof HttpError && e.status === 400) {
          console.log(`stats.fm: reached the API's limit at ${offset} tracks`);
          break;
        }
        throw e;
      }
      // Stop if the API ignores offset and sends the same page again
      if (items.length === 0 || seenPositions.has(items[0].position)) break;
      if (offset > 0) await new Promise(r => setTimeout(r, 1500));   // go gently: one page every 1.5s
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
    console.log(`stats.fm unavailable (${e.message.split(" for ")[0]})`);
    return null;
  }
}

module.exports = { getPlayCounts };
