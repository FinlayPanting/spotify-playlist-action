// Spotify Daily Playlist Rotator
// This script will:
// 1. Clear the daily playlist
// 2. Add everyday tracks in reverse order (newest first)
// 3. Add random tracks from 2025 Favorites, A-List, B-List and Seasonal

const SpotifyWebApi = require('spotify-web-api-node');

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
    B_LIST_COUNT: parseInt(process.env.B_LIST_COUNT || '5'),
    SEASON_COUNT: parseInt(process.env.SEASON_COUNT || '5'),
    FAVES_2025_COUNT: parseInt(process.env.FAVES_2025_COUNT || '10')
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
    
// Fisher-Yates shuffle
    const shuffled = [...allTracks]; // Create a copy
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
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
    const reversedEverydayTracks = [...everydayTracks].reverse();
    console.log('Reversed Everyday tracks so newest tracks will appear at top');
    
    // Step 4: Add the reversed everyday tracks
    if (reversedEverydayTracks.length > 0) {
      await addTracksToPlaylist(config.playlists.DAILY, reversedEverydayTracks);
      console.log(`Added ${reversedEverydayTracks.length} Everyday tracks in reverse order`);
    }
    
    // Step 5: Get new random tracks from each source playlist
    const newFaves2025Tracks = await getRandomTracks(config.playlists.FAVES_2025, config.tracks.FAVES_2025_COUNT);
    const newSeasonTracks = await getRandomTracks(config.playlists.SEASON, config.tracks.SEASON_COUNT);
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
    ];
    
    if (tracksToAdd.length > 0) {
      await addTracksToPlaylist(config.playlists.DAILY, tracksToAdd);
      console.log(`Added ${tracksToAdd.length} random tracks to daily playlist`);
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
