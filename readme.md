# Spotify Playlist Rotator

This GitHub Action automatically refreshes a Spotify playlist by:
1. Clearing your daily playlist completely
2. Adding all tracks from your "Everyday" playlist (your permanent tracks)
3. Adding random tracks from your other playlists (A-List, B-List, and 2025 Favorites)

## How It Works

* The script runs automatically every day at 3:00 AM UTC
* It uses the GitHub Actions scheduler for reliable execution
* All sensitive information is stored in GitHub Secrets
* Track counts can be easily adjusted through GitHub Secrets

## Setup Instructions

1. **Create a new "Everyday" playlist in Spotify**
   
   Create a playlist with all the tracks you want to appear permanently in your daily playlist

2. **Create GitHub Secrets**

   Go to your repository's Settings > Secrets and variables > Actions and add these secrets:
   
   **Required secrets:**
   - `SPOTIFY_CLIENT_ID`: Your Spotify application client ID
   - `SPOTIFY_CLIENT_SECRET`: Your Spotify application client secret
   - `SPOTIFY_REFRESH_TOKEN`: Your Spotify refresh token
   - `DAILY_PLAYLIST_ID`: ID of your daily playlist
   - `EVERYDAY_PLAYLIST_ID`: ID of your everyday playlist with permanent tracks
   - `A_LIST_PLAYLIST_ID`: ID of your A-List playlist
   - `B_LIST_PLAYLIST_ID`: ID of your B-List playlist
   - `FAVES_2025_PLAYLIST_ID`: ID of your 2025 Favorites playlist
   
   **Track count secrets:**
   - `A_LIST_COUNT`: Number of tracks to pull from A-List (default: 10)
   - `B_LIST_COUNT`: Number of tracks to pull from B-List (default: 5)
   - `FAVES_2025_COUNT`: Number of tracks to pull from 2025 Favorites (default: 10)

3. **Trigger the Action**

   The action will run automatically every day at 3:00 AM, but you can also trigger it manually:
   
   - Go to the "Actions" tab
   - Select "Spotify Playlist Refresh" workflow
   - Click "Run workflow" button

## Adjusting Track Counts

To change how many tracks are pulled from each playlist:

1. Go to Settings > Secrets and variables > Actions
2. Add or update the secrets:
   - `A_LIST_COUNT` (default: 10 if not specified)
   - `B_LIST_COUNT` (default: 5 if not specified)
   - `FAVES_2025_COUNT` (default: 10 if not specified)

## Monitoring

You can check the results of each run in the "Actions" tab. Each run will show logs with details about tracks added.
