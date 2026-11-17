// Weekly "All Bangers" playlist
// 1. Pulls every track from A-List, B-List and Year Faves
// 2. Flags suspected duplicates (same song name + artist, within or across lists)
// 3. Rebuilds the combined playlist best-to-worst, each song only once
//
// "Best" is a score out of 100 mixing three signals (weights below):
//   - list:       which list the song is on (best list wins if it's on several)
//   - plays:      how much you've played it, from stats.fm (skipped if unavailable)
//   - popularity: Spotify's general popularity score
// Each signal is 0-1; missing signals are left out and the rest re-weighted.
//
// Writes history/duplicates.md, history/bangers-ranking.csv and a job summary.

const fs = require('fs');
const path = require('path');
const { createClient, getAllPlaylistTracks, replacePlaylist } = require('./lib/spotify');
const { getPlayCounts } = require('./lib/statsfm');

// ---- Tune the ranking here ----
const WEIGHTS = { list: 0.4, plays: 0.4, popularity: 0.2 };
const LIST_VALUE = { 'A-List': 1.0, 'Year Faves': 0.7, 'B-List': 0.4 };
const STATSFM_USER = process.env.STATSFM_USER || '';
const STATSFM_RANGE = process.env.STATSFM_RANGE || 'lifetime';   // or 'months' (6 months), 'weeks' (4 weeks)

const SOURCES = [
  { name: 'A-List', id: process.env.A_LIST_PLAYLIST_ID },
  { name: 'B-List', id: process.env.B_LIST_PLAYLIST_ID },
  { name: 'Year Faves', id: process.env.FAVES_2025_PLAYLIST_ID }
];
const TARGET = process.env.WEEKLY_PLAYLIST_ID;
const REPORT_FILE = path.join(__dirname, 'history', 'duplicates.md');
const RANKING_FILE = path.join(__dirname, 'history', 'bangers-ranking.csv');

// "Mr. Brightside" by The Killers and "mr brightside" by the killers count as the same song
function normalise(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function songKey(t) {
  return normalise(t.name) + ' — ' + t.artists.map(normalise).sort().join(', ');
}

function findDuplicates(all) {
  const groups = new Map();
  for (const t of all) {
    const k = songKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

// Turn raw values into 0-1 by rank among songs that have a value (robust to huge play counts)
function percentiles(songs, getValue) {
  const vals = songs.map(getValue).filter(v => v !== null && v !== undefined);
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const pct = v => {
    let lo = 0, hi = sorted.length;            // count of values strictly below v
    while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < v ? lo = m + 1 : hi = m; }
    return (lo + 1) / sorted.length;           // any value > 0, so 'some plays' beats 'no plays'
  };
  return s => { const v = getValue(s); return v === null || v === undefined ? 0 : pct(v); };
}

function rankSongs(all, stats) {
  // Merge copies of the same song across lists
  const songs = new Map();
  for (const t of all) {
    const k = songKey(t);
    const existing = songs.get(k);
    if (!existing) {
      songs.set(k, { key: k, uri: t.uri, name: t.name, artists: t.artists, lists: [t.source],
        listValue: LIST_VALUE[t.source] ?? 0, popularity: t.popularity, uris: [t.uri] });
    } else {
      if (!existing.lists.includes(t.source)) existing.lists.push(t.source);
      existing.uris.push(t.uri);
      if ((LIST_VALUE[t.source] ?? 0) > existing.listValue) {
        existing.listValue = LIST_VALUE[t.source];
        existing.uri = t.uri;                     // keep the version from the best list
      }
      if (t.popularity !== null && (existing.popularity === null || t.popularity > existing.popularity)) {
        existing.popularity = t.popularity;
      }
    }
  }
  const list = [...songs.values()];

  // Attach stats.fm data
  if (stats) {
    for (const s of list) {
      const e = s.uris.map(u => stats.bySpotifyId.get(u.split(':')[2])).find(Boolean) || stats.byName.get(s.key);
      s.plays = e ? e.plays : null;
      s.statsPosition = e ? e.position : null;
    }
  }

  const signals = { list: s => s.listValue };
  const pop = percentiles(list, s => s.popularity);
  if (pop) signals.popularity = pop;
  if (stats) {
    // With Plus: real play counts. Without: stats.fm rank (position 1 = best)
    const plays = stats.hasCounts ? percentiles(list, s => s.plays)
                                  : percentiles(list, s => s.statsPosition === null ? null : -s.statsPosition);
    if (plays) signals.plays = plays;
  }
  const used = Object.keys(signals);
  const totalW = used.reduce((a, k) => a + WEIGHTS[k], 0);
  console.log(`Ranking signals: ${used.map(k => `${k} ${Math.round(WEIGHTS[k] / totalW * 100)}%`).join(', ')}`);

  for (const s of list) {
    s.score = 100 * used.reduce((a, k) => a + WEIGHTS[k] * signals[k](s), 0) / totalW;
    s.tiebreak = Math.random();
  }
  list.sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak);
  return { list, used };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeRanking(list) {
  const rows = [['rank', 'score', 'song', 'artists', 'lists', 'spotify_popularity', 'plays', 'statsfm_rank', 'track_uri']];
  list.forEach((s, i) => rows.push([i + 1, s.score.toFixed(1), s.name, s.artists.join('; '), s.lists.join(' + '),
    s.popularity ?? '', s.plays ?? '', s.statsPosition ?? '', s.uri]));
  fs.writeFileSync(RANKING_FILE, rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n');
}

function buildReport(date, counts, dupes, added) {
  const lines = [`# Duplicate check — ${date}`, ''];
  lines.push(counts.map(c => `${c.name}: ${c.count}`).join(' · ') + ` → ${added} unique songs in the combined playlist (ranked best to worst; see bangers-ranking.csv)`, '');
  if (dupes.length === 0) {
    lines.push('No suspected duplicates this week. ✅');
  } else {
    lines.push(`**${dupes.length} suspected duplicate${dupes.length > 1 ? 's' : ''}** (same song name and artist):`, '');
    lines.push('| Song | Artist | Where it appears |', '|---|---|---|');
    for (const g of dupes) {
      const where = g.map(t => `${t.source} #${t.position}`).join(', ');
      const sameVersion = new Set(g.map(t => t.uri)).size === 1 ? '' : ' _(different versions)_';
      lines.push(`| ${g[0].name.replace(/\|/g, '/')} | ${g[0].artists.join(', ')} | ${where}${sameVersion} |`);
    }
  }
  return lines.join('\n') + '\n';
}

(async () => {
  if (!TARGET) throw new Error('WEEKLY_PLAYLIST_ID is not set');
  const api = await createClient();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date());

  const all = [];
  const counts = [];
  for (const s of SOURCES) {
    const tracks = (await getAllPlaylistTracks(api, s.id)).map(t => ({ ...t, source: s.name }));
    console.log(`${s.name}: ${tracks.length} tracks`);
    counts.push({ name: s.name, count: tracks.length });
    all.push(...tracks);
  }

  const dupes = findDuplicates(all);
  console.log(`Suspected duplicates: ${dupes.length}`);

  // One copy of each song, ranked best to worst
  const stats = await getPlayCounts(STATSFM_USER, STATSFM_RANGE, songKey);
  const { list: ranked } = rankSongs(all, stats);
  const withPop = ranked.filter(s => s.popularity !== null).length;
  console.log(`Spotify popularity available for ${withPop}/${ranked.length} songs`);
  const uris = ranked.map(s => s.uri);

  await replacePlaylist(api, TARGET, uris);
  console.log(`Combined playlist rebuilt with ${uris.length} songs, best to worst`);
  console.log('Top 10:');
  ranked.slice(0, 10).forEach((s, i) => console.log(`  ${i + 1}. ${s.name} — ${s.artists.join(', ')} (${s.score.toFixed(1)})`));

  fs.mkdirSync(path.dirname(RANKING_FILE), { recursive: true });
  writeRanking(ranked);

  const report = buildReport(date, counts, dupes, uris.length);
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `duplicates=${dupes.length}\n`);
  console.log('\n' + report);
})().catch(err => {
  console.error('Weekly refresh failed:', err.message);
  process.exit(1);
});
