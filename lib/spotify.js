// Shared Spotify helpers (used by weekly.js)
const SpotifyWebApi = require('spotify-web-api-node');

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    const res = await api.getPlaylistTracks(playlistId, { limit: 100, offset });
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
  await api.replaceTracksInPlaylist(playlistId, uris.slice(0, 100));
  for (let i = 100; i < uris.length; i += 100) {
    await sleep(100);
    await api.addTracksToPlaylist(playlistId, uris.slice(i, i + 100));
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
