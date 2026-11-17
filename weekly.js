// Weekly "All Bangers" playlist
// 1. Pulls every track from A-List, B-List and Year Faves
// 2. Flags suspected duplicates (same song name + artist, within or across lists)
// 3. Rebuilds the combined playlist in a random order, each song only once
//
// Writes history/duplicates.md and, when run in GitHub Actions, a job summary.

const fs = require('fs');
const path = require('path');
const { createClient, getAllPlaylistTracks, replacePlaylist, shuffle } = require('./lib/spotify');

const SOURCES = [
  { name: 'A-List', id: process.env.A_LIST_PLAYLIST_ID },
  { name: 'B-List', id: process.env.B_LIST_PLAYLIST_ID },
  { name: 'Year Faves', id: process.env.FAVES_2025_PLAYLIST_ID }
];
const TARGET = process.env.WEEKLY_PLAYLIST_ID;
const REPORT_FILE = path.join(__dirname, 'history', 'duplicates.md');

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

function buildReport(date, counts, dupes, added) {
  const lines = [`# Duplicate check — ${date}`, ''];
  lines.push(counts.map(c => `${c.name}: ${c.count}`).join(' · ') + ` → ${added} unique songs in the combined playlist`, '');
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

  // One copy of each song, then shuffle
  const seen = new Set();
  const unique = all.filter(t => {
    const k = songKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const uris = shuffle(unique).map(t => t.uri);

  await replacePlaylist(api, TARGET, uris);
  console.log(`Combined playlist rebuilt with ${uris.length} songs in random order`);

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
