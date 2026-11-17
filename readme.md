# Spotify Playlist Rotator

An automated playlist that refreshes every morning with a mix of new songs and favourites selected from pre-defined playlists.

You can find the resulting playlist here: https://open.spotify.com/playlist/2jCeQ3OVchYFg9bBN6XNvP?si=1595d743bd804880.

## Why I Built This

Due to personal projects that needed me to keep up to date with the latest music, I found my music listening experience to be more like a job than a hobby - always moving onto the next thing without enjoying the music I loved. This year, I wanted to create a playlist that allowed me to get familiar with new music, whilst enjoying favourites from the past. I started by manually curating a playlist with a mix of songs, but quickly realised I could automate this by mixing a variety of playlists using the Spotify API.

## The Result

This GitHub Action rebuilds a daily playlist at about 1:00 AM (Salzburg time) by:

* Adding all tracks from my "Everyday" playlist (new songs I like)
* Randomly selecting tracks from my Year Favourites (new songs -> favourites), A-List, and B-List playlists (favourites from previous years)
* Clearing and refreshing the playlist completely each day

Stack: Javascript, Spotify Web API, GitHub Actions

## How It Works

This GitHub Action automatically refreshes a Spotify playlist by:
1. Clearing your daily playlist completely
2. Adding tracks in this specific order:
   - All tracks from your "Everyday" playlist (in reverse order so newest appear at top)
   - Random tracks from 2025 Favorites playlist
   - Random tracks from A-List playlist
   - Random tracks from B-List playlist
   - Random tracks from Seasonal playlist

* The script runs automatically every day at 00:03 UTC (01:03 in Salzburg, 02:03 in summer)
* It uses the GitHub Actions scheduler for reliable execution
* All sensitive information is stored in GitHub Secrets
* Track counts can be easily adjusted through GitHub Secrets
* The Everyday playlist tracks are added in reverse order so your newest additions appear at the top

## Selection history

Every run appends the day's random picks (Year Faves, Seasonal, A-List, B-List) to `history/selections.csv` and commits it back to the repo. Columns: date, run time, source playlist, slot, track, artists, album, track URI, the track's position in its source playlist, the source playlist's size, how many were requested, and a note (e.g. which seasonal ramp was active). It opens directly in Excel or Google Sheets.

## Seasonal ramps

`seasonal-schedule.json` can override how many Seasonal tracks are added on certain dates, repeating every year. The Christmas ramp starts at 1 track on 25 November and adds one more each day, capped at 30 (reached on 24 December and held on the 25th). Outside a ramp, the `SEASON_COUNT` secret applies. Add more entries to `ramps` for other periods.

## Setup Instructions

1. **Create a new "Everyday" playlist in Spotify**
   
   Create a playlist with all the tracks you want to appear permanently in your daily playlist. New tracks added to the bottom of this playlist will appear at the top of your daily playlist.

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
   - `FAVES_2025_PLAYLIST_ID`: ID of your 2025 favorites playlist
   - `SEASONAL_PLAYLIST_ID`: ID of your seasonal playlist
   
   **Track count secrets:**
   - `A_LIST_COUNT`: Number of tracks to pull from A-List (default: 10)
   - `B_LIST_COUNT`: Number of tracks to pull from B-List (default: 15)
   - `FAVES_2025_COUNT`: Number of tracks to pull from 2025 Favorites (default: 20)
   - `SEASONAL_COUNT`: Number of tracks to pull from seasonal (default: 5)

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
   - `B_LIST_COUNT` (default: 15 if not specified)
   - `FAVES_2025_COUNT` (default: 20 if not specified)
   - `SEASONAL_COUNT` (default: 5 if not specified)

## Monitoring

You can check the results of each run in the "Actions" tab. Each run will show logs with details about tracks added.

## Weekly Bangers playlist

A second workflow (`weekly-bangers.yml`, Sundays 18:41 Salzburg time) rebuilds a big combined playlist from A-List, B-List and Year Faves, ordered best to worst with each song only once. Each song gets a score out of 100 from three signals: which list it's on (A 1.0, Year Faves 0.7, B 0.4; 40%), lifetime plays from stats.fm (40%) and Spotify popularity (20%). Missing signals are skipped and the rest re-weighted. Weights live at the top of `weekly.js`; the full ranking is saved to `history/bangers-ranking.csv`.

It also checks for suspected duplicates (same song name and artist, ignoring case and punctuation) within and across those three lists. The result is saved to `history/duplicates.md`, shown on the run's summary page, and posted to a GitHub issue when duplicates exist; the issue closes itself once the lists are clean.
