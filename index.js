// Spotify Daily Playlist Rotator (Script Version)
// This script will:
// 1. Pull 10 random songs from A-List playlist
// 2. Pull 5 random songs from B-List playlist
// 3. Pull 10 random songs from 2025 Favorites playlist
// 4. Remove all source playlist tracks from Daily playlist
// 5. Add the new random songs to Daily playlist

const SpotifyWebApi = require('spotify-web-api-node');

// Configuration (populated from GitHub Secrets)
const config = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.SPOTIFY_REFRESH_TOKEN,
  playlists: {
    DAILY: process.env.DAILY_PLAYLIST_ID,
    A_LIST: process.env.A_LIST_PLAYLIST_ID,
    B_LIST: process.env.B_LIST_PLAYLIST_ID,
    FAVES_2025: process.env.FAVES_2025_PLAYLIST_ID
  },
  tracks: {
    A_LIST_COUNT: 20,
    B_LIST_COUNT: 5,
    FAVES_2025_COUNT: 12
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

      // Filter out any null tracks and add to our collection
      const validTracks = response.body.items
        .filter(item => item && item.track)
        .map(item => item.track.uri);

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

    // Shuffle the tracks
    const shuffled = allTracks.sort(() => 0.5 - Math.random());

    // Return the number of tracks we need (or all if we have fewer)
    const selectedTracks = shuffled.slice(0, Math.min(count, shuffled.length));
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
    console.log(`- A-List: ${config.playlists.A_LIST}`);
    console.log(`- B-List: ${config.playlists.B_LIST}`);
    console.log(`- 2025 Favorites: ${config.playlists.FAVES_2025}`);

    // Get all tracks from source playlists
    const aListTracks = await getAllPlaylistTracks(config.playlists.A_LIST);
    const bListTracks = await getAllPlaylistTracks(config.playlists.B_LIST);
    const faves2025Tracks = await getAllPlaylistTracks(config.playlists.FAVES_2025);

    // Create sets for faster lookup
    const aListSet = new Set(aListTracks);
    const bListSet = new Set(bListTracks);
    const faves2025Set = new Set(faves2025Tracks);

    // Get all tracks from daily playlist
    const dailyPlaylistTracks = await getAllPlaylistTracks(config.playlists.DAILY);
    console.log(`Total tracks in daily playlist: ${dailyPlaylistTracks.length}`);

    // Find all tracks in daily playlist that are from our source playlists
    const tracksToRemove = dailyPlaylistTracks.filter(track =>
      aListSet.has(track) || bListSet.has(track) || faves2025Set.has(track)
    );

    console.log(`Found ${tracksToRemove.length} tracks from source playlists to remove`);

    // Remove all source playlist tracks from daily playlist
    if (tracksToRemove.length > 0) {
      await removeTracksFromPlaylist(config.playlists.DAILY, tracksToRemove);
      console.log(`Removed ${tracksToRemove.length} tracks from daily playlist`);
    }

    // Get new random tracks from each source playlist
    const newAListTracks = await getRandomTracks(config.playlists.A_LIST, config.tracks.A_LIST_COUNT);
    const newBListTracks = await getRandomTracks(config.playlists.B_LIST, config.tracks.B_LIST_COUNT);
    const newFaves2025Tracks = await getRandomTracks(config.playlists.FAVES_2025, config.tracks.FAVES_2025_COUNT);

    console.log(`New A-List tracks to add: ${newAListTracks.length}`);
    console.log(`New B-List tracks to add: ${newBListTracks.length}`);
    console.log(`New 2025 Favorites tracks to add: ${newFaves2025Tracks.length}`);

    // Add new tracks to daily playlist
    const tracksToAdd = [...newAListTracks, ...newBListTracks, ...newFaves2025Tracks];
    if (tracksToAdd.length > 0) {
      await addTracksToPlaylist(config.playlists.DAILY, tracksToAdd);
      console.log(`Added ${tracksToAdd.length} tracks to daily playlist`);
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
