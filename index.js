// Spotify Daily Playlist Rotator
// This script will:
// 1. Clear the daily playlist
// 2. Add everyday tracks in reverse order (newest first)
// 3. Add random tracks from 2025 Favorites, A-List, B-List and Seasonal
// 4. Log the random selections to history/selections.csv for trend analysis
//
// The Seasonal count can be overridden by date via seasonal-schedule.json
// (e.g. a Christmas ramp that adds one more track each day).

const fs = require('fs');
const path = require('path');
const SpotifyWebApi = require('spotify-web-api-node');

const HISTORY_FILE = path.join(__dirname, 'history', 'selections.csv');
const SCHEDULE_FILE = path.join(__dirname, 'seasonal-schedule.json');

// Configuration (populated from GitHub Secrets)
const config = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
  playlists: {
    DAILY: process.env.DAILY_PLAYLIST_ID,
    EVERYDAY: process.env.EVERYDAY_PLAYLIST_ID,
    A_LIST: process.env.A_LIST_PLAYLIST_ID,
    B_LIST: process.env.B_LIST_PLAYLIST_ID,
    SEASON: process.env.SEASON_PLAYLIST_ID,
    FAVES_2025: process.env.FAVES_2025_PLAYLIST_ID
  },
  tracks: {
    A_LIST_COUNT: parseInt(process.env.A_LIST_COUNT || '10'),
    B_LIST_COUNT: parseInt(process.env.B_LIST_COUNT || '15'),
    SEASON_COUNT: parseInt(process.env.SEASON_COUNT || '5'),
    FAVES_2025_COUNT: parseInt(process.env.FAVES_2025_COUNT || '20')
  }
};

// Create Spotify API client
const spotifyApi = new SpotifyWebApi({
  clientId: config.clientId,
  clientSecret: config.clientSecret
});

// Set the refresh token
spotifyApi.setRefreshToken(config.refreshToken);

// Get all tracks from a playlist
async function getAllPlaylistTracks(playlistId) {
  console.log(`Getting all tracks from playlist: ${playlistId}`);
  
  try {
    const allTracks = [];
    const limit = 100; // Spotify API limit per request
    let offset = 0;
    let total = Infinity; // Start with infinity to enter the loop
    
    // Make multiple requests to get all tracks
    while (offset < total) {
      const response = await spotifyApi.getPlaylistTracks(playlistId, {
        limit: limit,
        offset: offset
      });
      
      // Update total on first request
      if (offset === 0) {
        total = response.body.total;
        console.log(`Playlist has ${total} total tracks`);
      }
      
      console.log(`Got batch of ${response.body.items.length} tracks (offset ${offset}/${total})`);
      
      // Filter out any null tracks and keep the details we want to log
      const validTracks = response.body.items
        .map((item, i) => ({ item, position: offset + i + 1 }))
        .filter(({ item }) => item && item.track && item.track.uri)
        .map(({ item, position }) => ({
          uri: item.track.uri,
          name: item.track.name || '',
          artists: (item.track.artists || []).map(a => a.name).join('; '),
          album: (item.track.album && item.track.album.name) || '',
          position
        }));
      
      allTracks.push(...validTracks);
      offset += limit;
    }
    
    console.log(`Found ${allTracks.length} valid tracks in playlist`);
    return allTracks;
  } catch (error) {
    console.error(`Error getting tracks from playlist ${playlistId}:`, error.message);
    return [];
  }
}

// Get random tracks from a playlist
async function getRandomTracks(playlistId, count) {
  console.log(`Getting random tracks from playlist: ${playlistId}`);
  
  try {
    // Get all tracks
    const allTracks = await getAllPlaylistTracks(playlistId);
    
// Fisher-Yates shuffle
    const shuffled = [...allTracks]; // Create a copy
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Return the number of tracks we need (or all if we have fewer)
    const selectedTracks = shuffled
      .slice(0, Math.min(count, shuffled.length))
      .map(t => ({ ...t, sourceSize: allTracks.length }));
    console.log(`Selected ${selectedTracks.length} random tracks`);
    return selectedTracks;
  } catch (error) {
    console.error(`Error getting random tracks from playlist ${playlistId}:`, error.message);
    return [];
  }
}

// Remove tracks from a playlist
async function removeTracksFromPlaylist(playlistId, trackUris) {
  if (trackUris.length === 0) return;
  
  // Spotify only allows removing 100 tracks at a time
  const batchSize = 100;
  for (let i = 0; i < trackUris.length; i += batchSize) {
    const batch = trackUris.slice(i, i + batchSize);
    console.log(`Removing batch of ${batch.length} tracks (${i+1}-${i+batch.length} of ${trackUris.length})`);
    
    await spotifyApi.removeTracksFromPlaylist(
      playlistId,
      batch.map(uri => ({ uri }))
    );
    
    // Small delay to avoid rate limits
    if (i + batchSize < trackUris.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// Add tracks to a playlist
async function addTracksToPlaylist(playlistId, trackUris) {
  if (trackUris.length === 0) return;
  
  // Spotify only allows adding 100 tracks at a time
  const batchSize = 100;
  for (let i = 0; i < trackUris.length; i += batchSize) {
    const batch = trackUris.slice(i, i + batchSize);
    console.log(`Adding batch of ${batch.length} tracks (${i+1}-${i+batch.length} of ${trackUris.length})`);
    
    await spotifyApi.addTracksToPlaylist(playlistId, batch);
    
    // Small delay to avoid rate limits
    if (i + batchSize < trackUris.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// ---------- Seasonal schedule ----------

// Today's date (YYYY-MM-DD) in the given time zone. RUN_DATE overrides it for testing.
function todayIn(timeZone) {
  if (process.env.RUN_DATE) return process.env.RUN_DATE;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function dayNumber(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// Returns { count, reason } for the Seasonal playlist today
function getSeasonCount(defaultCount) {
  let schedule;
  try {
    schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  } catch (e) {
    return { count: defaultCount, reason: 'default (no schedule file)', date: todayIn('Europe/Vienna') };
  }

  const tz = schedule.timezone || 'Europe/Vienna';
  const today = todayIn(tz);
  const year = Number(today.slice(0, 4));
  const todayN = dayNumber(today);

  for (const ramp of schedule.ramps || []) {
    // Ramps repeat yearly; handle ranges that cross New Year (e.g. 12-20 to 01-06)
    const wraps = ramp.end < ramp.start;
    let startYear = year;
    if (wraps && today.slice(5) <= ramp.end) startYear = year - 1;
    const startN = dayNumber(`${startYear}-${ramp.start}`);
    const endN = dayNumber(`${wraps ? startYear + 1 : startYear}-${ramp.end}`);

    if (todayN >= startN && todayN <= endN) {
      const days = todayN - startN;
      const raw = (ramp.startCount ?? 1) + (ramp.stepPerDay ?? 1) * days;
      const count = Math.max(0, Math.min(raw, ramp.maxCount ?? raw));
      return { count, reason: `${ramp.name} ramp, day ${days + 1}`, date: today };
    }
  }
  return { count: defaultCount, reason: 'default (SEASON_COUNT)', date: today };
}

// ---------- Selection history ----------

const CSV_HEADER = [
  'date', 'run_time_utc', 'source', 'slot', 'track_name', 'artists', 'album',
  'track_uri', 'source_position', 'source_size', 'count_requested', 'note'
];

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function logSelections(date, groups) {
  const runTime = new Date().toISOString();
  const rows = [];
  for (const g of groups) {
    g.tracks.forEach((t, i) => {
      rows.push([
        date, runTime, g.source, i + 1, t.name, t.artists, t.album,
        t.uri, t.position, t.sourceSize, g.requested, g.note || ''
      ].map(csvCell).join(','));
    });
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const isNew = !fs.existsSync(HISTORY_FILE);
  const text = (isNew ? CSV_HEADER.join(',') + '\n' : '') + rows.map(r => r + '\n').join('');
  fs.appendFileSync(HISTORY_FILE, text);
  console.log(`Logged ${rows.length} selections to ${path.relative(__dirname, HISTORY_FILE)}`);
}

// Main function to refresh playlist
async function refreshDailyPlaylist() {
  console.log('Starting daily playlist refresh...');
  console.log(new Date().toISOString());
  
  try {
    // Refresh the access token
    console.log('Refreshing access token...');
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body.access_token);
    console.log('Access token refreshed successfully');
    
    // Verify authentication
    const me = await spotifyApi.getMe();
    console.log(`Authenticated as: ${me.body.display_name} (${me.body.id})`);
    
    // Log playlist IDs
    console.log('Using playlist IDs:');
    console.log(`- Daily: ${config.playlists.DAILY}`);
    console.log(`- Everyday: ${config.playlists.EVERYDAY}`);
    console.log(`- A-List: ${config.playlists.A_LIST}`);
    console.log(`- B-List: ${config.playlists.B_LIST}`);
    console.log(`- Season: ${config.playlists.SEASON}`);
    console.log(`- 2025 Favorites: ${config.playlists.FAVES_2025}`);
    
    // Step 1: Clear the daily playlist completely
    console.log('Clearing daily playlist...');
    await spotifyApi.replaceTracksInPlaylist(config.playlists.DAILY, []);
    console.log('Daily playlist cleared successfully');
    
    // Step 2: Get all tracks from the "Everyday" playlist
    const everydayTracks = await getAllPlaylistTracks(config.playlists.EVERYDAY);
    console.log(`Getting ${everydayTracks.length} tracks from Everyday playlist`);
    
    // Step 3: Reverse the everyday tracks order so newest appear at the top
    const reversedEverydayTracks = everydayTracks.map(t => t.uri).reverse();
    console.log('Reversed Everyday tracks so newest tracks will appear at top');
    
    // Step 4: Add the reversed everyday tracks
    if (reversedEverydayTracks.length > 0) {
      await addTracksToPlaylist(config.playlists.DAILY, reversedEverydayTracks);
      console.log(`Added ${reversedEverydayTracks.length} Everyday tracks in reverse order`);
    }
    
    // Step 5: Get new random tracks from each source playlist
    const season = getSeasonCount(config.tracks.SEASON_COUNT);
    console.log(`Season count for ${season.date}: ${season.count} (${season.reason})`);

    const newFaves2025Tracks = await getRandomTracks(config.playlists.FAVES_2025, config.tracks.FAVES_2025_COUNT);
    const newSeasonTracks = await getRandomTracks(config.playlists.SEASON, season.count);
    const newAListTracks = await getRandomTracks(config.playlists.A_LIST, config.tracks.A_LIST_COUNT);
    const newBListTracks = await getRandomTracks(config.playlists.B_LIST, config.tracks.B_LIST_COUNT);
    
    console.log(`New 2025 Favorites tracks to add: ${newFaves2025Tracks.length}`);
    console.log(`New Season tracks to add: ${newSeasonTracks.length}`);
    console.log(`New A-List tracks to add: ${newAListTracks.length}`);
    console.log(`New B-List tracks to add: ${newBListTracks.length}`);
    
    // Step 6: Add new tracks to daily playlist in the correct order
    const tracksToAdd = [
      ...newFaves2025Tracks,  // 2025 Favorites first
      ...newSeasonTracks,       //Season second
      ...newAListTracks,      // A-List third
      ...newBListTracks       // B-List last
    ].map(t => t.uri);
    
    if (tracksToAdd.length > 0) {
      await addTracksToPlaylist(config.playlists.DAILY, tracksToAdd);
      console.log(`Added ${tracksToAdd.length} random tracks to daily playlist`);
    }

    // Step 7: Record today's random picks (a logging failure never fails the run)
    try {
      logSelections(season.date, [
        { source: 'Year Faves', tracks: newFaves2025Tracks, requested: config.tracks.FAVES_2025_COUNT },
        { source: 'Seasonal', tracks: newSeasonTracks, requested: season.count, note: season.reason },
        { source: 'A-List', tracks: newAListTracks, requested: config.tracks.A_LIST_COUNT },
        { source: 'B-List', tracks: newBListTracks, requested: config.tracks.B_LIST_COUNT }
      ]);
    } catch (e) {
      console.error('Could not write selection history:', e.message);
    }
    
    console.log('Daily playlist successfully refreshed!');
    return true;
  } catch (error) {
    console.error('Error refreshing playlist:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run the script
(async () => {
  try {
    const success = await refreshDailyPlaylist();
    
    if (success) {
      console.log('Script completed successfully!');
      process.exit(0);
    } else {
      console.error('Script failed to complete successfully');
      process.exit(1);
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
})();
