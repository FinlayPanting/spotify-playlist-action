// Shared Spotify helpers (used by weekly.js)
const SpotifyWebApi = require('spotify-web-api-node');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retry politely if Spotify says we're going too fast (HTTP 429), waiting as long as it asks
async function withRetry(fn, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.statusCode || e.status;
      if (status !== 429 || i >= tries) throw e;
      const wait = Number((e.headers && e.headers['retry-after']) || 5) * 1000;
      console.log(`Spotify rate limit hit, waiting ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

async function createClient() {
  const api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET
  });
  api.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);
  const data = await api.refreshAccessToken();
  api.setAccessToken(data.body.access_token);
  return api;
}

// All tracks in a playlist, with the details needed for logging and duplicate checks
async function getAllPlaylistTracks(api, playlistId) {
  const tracks = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const res = await withRetry(() => api.getPlaylistTracks(playlistId, {
      limit: 100, offset,
      fields: 'total,items(track(uri,name,type,popularity,artists(name)))'
    }));
    total = res.body.total;
    res.body.items.forEach((item, i) => {
      const t = item && item.track;
      if (!t || !t.uri || t.type === 'episode') return;
      tracks.push({
        uri: t.uri,
        name: t.name || '',
        artists: (t.artists || []).map(a => a.name),
        popularity: typeof t.popularity === 'number' ? t.popularity : null,
        position: offset + i + 1
      });
    });
    offset += 100;
  }
  return tracks;
}

// Replace a playlist's contents with the given URIs (any length)
async function replacePlaylist(api, playlistId, uris) {
  await withRetry(() => api.replaceTracksInPlaylist(playlistId, uris.slice(0, 100)));
  for (let i = 100; i < uris.length; i += 100) {
    await sleep(250);
    const batch = uris.slice(i, i + 100);
    await withRetry(() => api.addTracksToPlaylist(playlistId, batch));
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { createClient, getAllPlaylistTracks, replacePlaylist, shuffle };
