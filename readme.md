# Spotify Playlist Rotator

This GitHub Action automatically refreshes a Spotify playlist by:
1. Removing any tracks from the Daily playlist that are found in the source playlists
2. Adding 10 random tracks from the A-List playlist
3. Adding 5 random tracks from the B-List playlist
4. Adding 10 random tracks from the 2025 Favorites playlist

## How It Works

* The script runs automatically every day at 3:00 AM UTC
* It uses the GitHub Actions scheduler for reliable execution
* All sensitive information is stored in GitHub Secrets

## Setup Instructions

1. **Create GitHub Secrets**

   Go to your repository's Settings > Secrets and variables > Actions and add these secrets:

   - `SPOTIFY_CLIENT_ID`: Your Spotify application client ID
   - `SPOTIFY_CLIENT_SECRET`: Your Spotify application client secret
   - `SPOTIFY_REFRESH_TOKEN`: Your Spotify refresh token
   - `DAILY_PLAYLIST_ID`: ID of your daily playlist
   - `A_LIST_PLAYLIST_ID`: ID of your A-List playlist
   - `B_LIST_PLAYLIST_ID`: ID of your B-List playlist
   - `FAVES_2025_PLAYLIST_ID`: ID of your 2025 Favorites playlist

2. **Trigger the Action**

   The action will run automatically every day at 3:00 AM, but you can also trigger it manually:

   - Go to the "Actions" tab
   - Select "Spotify Playlist Refresh" workflow
   - Click "Run workflow" button

## Monitoring

You can check the results of each run in the "Actions" tab. Each run will show logs with details about tracks removed and added.
