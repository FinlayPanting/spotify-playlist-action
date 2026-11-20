// Aux playlist: songs from your library that a friend is likely to enjoy.
//
// 1. Reads the "Aux Seeds" playlist (songs the friend played / liked)
// 2. Builds a taste profile from Last.fm: similar artists, similar tracks, genre tags
// 3. Scores every song in A-List, B-List, Year Faves and Everyday against it
// 4. Picks 100: ~80 closest matches + ~20 "stretch" picks, max 3 per artist
//    - engine "lastfm": picks by score
//    - engine "claude": Claude chooses and orders the 100 from a scored shortlist
// 5. Writes the playlist(s) and a private report of why each song was picked
//
// Public logs show counts only; song-level detail goes to DATA_DIR (private repo).

const fs = require('fs');
const path = require('path');
const { createClient, getAllPlaylistTracks, replacePlaylist } = require('./lib/spotify');
const { LastFm } = require('./lib/lastfm');

const SIZE = 100;
const STRETCH = 20;
const MAX_PER_ARTIST = 3;
const WEIGHTS = { artist: 0.40, track: 0.25, tags: 0.25, bangers: 0.10 };

const ENGINE = (process.env.ENGINE || 'both').toLowerCase();       // lastfm | claude | both
const VIBE = (process.env.VIBE || '').trim();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'history');
const SEEDS_ID = process.env.AUX_SEEDS_PLAYLIST_ID;
const OUT_LASTFM = process.env.AUX_PLAYLIST_ID;
const OUT_CLAUDE = process.env.AUX_CLAUDE_PLAYLIST_ID || '';
const CLAUDE_MODEL = process.env.AUX_CLAUDE_MODEL || 'claude-sonnet-5-5';

const LIBRARY = [
  { name: 'A-List', id: process.env.A_LIST_PLAYLIST_ID },
  { name: 'B-List', id: process.env.B_LIST_PLAYLIST_ID },
  { name: 'Year Faves', id: process.env.FAVES_2025_PLAYLIST_ID },
  { name: 'Everyday', id: process.env.EVERYDAY_PLAYLIST_ID }
];

// ---------- name matching ----------
function normalise(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
// "Song (feat. X) - 2011 Remaster" -> "song"
function baseTitle(s) {
  return normalise(String(s || '').replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s+-\s+.*$/, ''));
}
function songKey(t) {
  return normalise(t.name) + ' — ' + t.artists.map(normalise).sort().join(', ');
}
const trackKey = (title, artist) => baseTitle(title) + '|' + normalise(artist);

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of Object.entries(a)) { na += v * v; if (b[k]) dot += v * b[k]; }
  for (const v of Object.values(b)) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function bangersScores() {
  const file = path.join(DATA_DIR, 'bangers-ranking.csv');
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
    const c = line.split(',');
    map.set(c[c.length - 1], Number(c[1]) || 0);   // score is column 2, URI is last
  }
  return map;
}

// ---------- taste profile ----------
async function buildProfile(lf, seeds) {
  // Main artists count fully; featured artists (and things like "Grand Theft Auto VI"
  // listed as an artist on soundtrack songs) only count a little.
  const seedArtists = new Map();          // norm -> { name, weight, main }
  for (const s of seeds) {
    s.artists.forEach((a, i) => {
      const k = normalise(a);
      const e = seedArtists.get(k) || { name: a, weight: 0, main: false };
      e.weight += i === 0 ? 1 : 0.2;
      e.main = e.main || i === 0;
      seedArtists.set(k, e);
    });
  }

  const artistSim = new Map();            // norm artist -> 0..1
  const bump = (name, v) => { const k = normalise(name); if (v > (artistSim.get(k) || 0)) artistSim.set(k, v); };
  for (const [k, e] of seedArtists) artistSim.set(k, e.main ? 1 : 0.5);

  const trackSim = new Map();             // trackKey -> 0..1
  const tagProfile = {};

  for (const { name, weight, main } of seedArtists.values()) {
    if (main) for (const a of await lf.similarArtists(name)) bump(a.name, a.match * 0.9);
    const tags = await lf.artistTags(name);
    for (const [t, v] of Object.entries(tags)) tagProfile[t] = (tagProfile[t] || 0) + v * weight;
  }
  for (const s of seeds) {
    for (const t of await lf.similarTracks(s.artists[0], s.name)) {
      if (!t.artist) continue;
      const k = trackKey(t.name, t.artist);
      if (t.match > (trackSim.get(k) || 0)) trackSim.set(k, t.match);
      bump(t.artist, t.match * 0.7);
    }
  }
  return { seedArtists, artistSim, trackSim, tagProfile };
}

async function scoreLibrary(lf, library, profile, bangers) {
  // tags for every primary artist in the library (cached for 60 days)
  const artistTags = new Map();
  const primaries = [...new Set(library.map(s => s.artists[0]))];
  console.log(`Fetching tags for ${primaries.length} library artists (cached after the first run)`);
  for (const a of primaries) artistTags.set(normalise(a), await lf.artistTags(a));

  for (const s of library) {
    // a song's main artist counts fully, featured artists at 60%
    const artist = Math.max(0, ...s.artists.map((a, i) => (profile.artistSim.get(normalise(a)) || 0) * (i === 0 ? 1 : 0.6)));
    const track = Math.max(0, ...s.artists.map(a => profile.trackSim.get(trackKey(s.name, a)) || 0));
    s.tags = artistTags.get(normalise(s.artists[0])) || {};
    const tags = cosine(profile.tagProfile, s.tags);
    const b = (bangers.get(s.uri) ?? 50) / 100;
    s.parts = { artist, track, tags, bangers: b };
    s.score = 100 * (WEIGHTS.artist * artist + WEIGHTS.track * track + WEIGHTS.tags * tags + WEIGHTS.bangers * b);
  }
  return library.sort((a, b) => b.score - a.score);
}

function whyLastfm(s, profile) {
  const bits = [];
  const main = profile.seedArtists.get(normalise(s.artists[0]));
  if (main && main.main) bits.push('seed artist');
  else if (s.artists.some(a => profile.seedArtists.has(normalise(a)))) bits.push('features a seed artist');
  else if (s.parts.artist >= 0.3) bits.push(`similar artist (${Math.round(s.parts.artist * 100)}%)`);
  if (s.parts.track > 0) bits.push(`similar track (${Math.round(s.parts.track * 100)}%)`);
  const shared = Object.keys(s.tags).filter(t => profile.tagProfile[t]).slice(0, 3);
  if (shared.length) bits.push('tags: ' + shared.join(', '));
  return bits.join('; ') || 'general fit';
}

// ---------- selection ----------
function capPerArtist(list, n, counts = new Map()) {
  const out = [];
  for (const s of list) {
    if (out.length >= n) break;
    const k = normalise(s.artists[0]);
    if ((counts.get(k) || 0) >= MAX_PER_ARTIST) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
    out.push(s);
  }
  return out;
}

// Spread stretch picks through the list and avoid the same artist twice in a row
function arrange(main, stretch) {
  const out = [];
  let si = 0;
  for (let i = 0; i < main.length; i++) {
    out.push(main[i]);
    if ((i + 1) % 4 === 0 && si < stretch.length) out.push(stretch[si++]);
  }
  while (si < stretch.length) out.push(stretch[si++]);
  for (let i = 1; i < out.length; i++) {
    if (normalise(out[i].artists[0]) === normalise(out[i - 1].artists[0])) {
      const j = out.findIndex((x, idx) => idx > i && normalise(x.artists[0]) !== normalise(out[i].artists[0]));
      if (j > 0) [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

function pickLastfm(scored, profile) {
  const counts = new Map();
  const main = capPerArtist(scored, SIZE - STRETCH, counts);
  const chosen = new Set(main);
  // Stretch: not seed/similar artists, but the right genre neighbourhood; a little randomness for variety
  const pool = scored.filter(s => !chosen.has(s) && s.parts.artist < 0.3 && s.parts.tags >= 0.35)
    .sort((a, b) => (b.parts.tags * 0.7 + b.parts.bangers * 0.3) - (a.parts.tags * 0.7 + a.parts.bangers * 0.3))
    .slice(0, STRETCH * 3)
    .map(s => ({ s, r: Math.random() })).sort((a, b) => a.r - b.r).map(x => x.s);
  let stretch = capPerArtist(pool, STRETCH, counts);
  stretch.forEach(s => { s.stretch = true; chosen.add(s); });
  if (main.length + stretch.length < SIZE) {          // top up from the main ranking if short
    stretch = stretch.concat(capPerArtist(scored.filter(s => !chosen.has(s)), SIZE - main.length - stretch.length, counts));
  }
  return arrange(main, stretch).map(s => ({ ...s, why: (s.stretch ? 'stretch pick; ' : '') + whyLastfm(s, profile) }));
}

// ---------- Claude ----------
async function pickClaude(scored, seeds, profile) {
  const counts = new Map();
  const shortlist = capPerArtist(scored, 300, new Map());
  const inShort = new Set(shortlist);
  const stretchPool = scored.filter(s => !inShort.has(s) && s.parts.tags >= 0.3).slice(0, 80);
  const candidates = shortlist.concat(stretchPool);

  const topTags = Object.entries(profile.tagProfile).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  const lines = candidates.map((s, i) =>
    `${i}\t${s.name} — ${s.artists.join(', ')}\t${Object.keys(s.tags).slice(0, 3).join('/') || '-'}\tmatch ${Math.round(s.score)}`);

  const prompt = `You are helping pick music for a car journey. My friend is on the aux, and these are songs they played or liked:

${seeds.map(s => `- ${s.name} — ${s.artists.join(', ')}`).join('\n')}
${VIBE ? `\nThe vibe for this playlist: ${VIBE}\n` : ''}
Their taste in Last.fm genre tags: ${topTags.join(', ')}

Below are candidate songs from MY library, each with an id, genre tags and a similarity score (0-100) from Last.fm data. Choose exactly ${SIZE} songs my friend is most likely to enjoy:
- About ${SIZE - STRETCH} strong matches, plus about ${STRETCH} "stretch" picks that are a little further out but could land well, to test their taste.
- At most ${MAX_PER_ARTIST} songs by any one artist.
- Don't include the seed songs themselves.
- Order the list so it flows well as a playlist: energy and mood should move naturally, not jump around.
- Use your own knowledge of the songs and artists, not just the scores.

Reply with only JSON, no other text, in this shape:
{"picks":[{"id":0,"stretch":false,"why":"short reason, max 12 words"}]}

Candidates (id, song — artists, tags, score):
${lines.join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 12000, messages: [{ role: 'user', content: prompt }] })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(body.error && body.error.message) || 'unknown error'}`);
  const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  console.log(`Claude (${CLAUDE_MODEL}) returned ${json.picks.length} picks; tokens in/out: ${body.usage.input_tokens}/${body.usage.output_tokens}`);

  // Enforce the rules even if the model slips
  const seen = new Set();
  const out = [];
  for (const p of json.picks || []) {
    const s = candidates[p.id];
    if (!s || seen.has(s)) continue;
    const k = normalise(s.artists[0]);
    if ((counts.get(k) || 0) >= MAX_PER_ARTIST) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
    seen.add(s);
    out.push({ ...s, stretch: !!p.stretch, why: (p.stretch ? 'stretch pick; ' : '') + String(p.why || '').slice(0, 120) });
    if (out.length >= SIZE) break;
  }
  if (out.length < SIZE) {
    const extra = capPerArtist(candidates.filter(s => !seen.has(s)), SIZE - out.length, counts)
      .map(s => ({ ...s, why: 'top-up from Last.fm score' }));
    out.push(...extra);
  }
  return out;
}

// ---------- output ----------
function writeReport(file, title, seeds, picks, profile) {
  const lines = [`# ${title} — ${new Date().toISOString().slice(0, 10)}`, ''];
  if (VIBE) lines.push(`Vibe: ${VIBE}`, '');
  lines.push(`Seeds (${seeds.length}): ${seeds.map(s => `${s.name} — ${s.artists[0]}`).join(' · ')}`, '');
  const topTags = Object.entries(profile.tagProfile).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  lines.push(`Taste tags: ${topTags.join(', ') || '(none)'}`, '');
  lines.push('| # | Song | Artist | Score | Why |', '|---|---|---|---|---|');
  picks.forEach((s, i) => lines.push(`| ${i + 1} | ${s.name.replace(/\|/g, '/')} | ${s.artists.join(', ')} | ${Math.round(s.score)} | ${s.why.replace(/\|/g, '/')} |`));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

(async () => {
  if (!SEEDS_ID || !OUT_LASTFM) throw new Error('AUX_SEEDS_PLAYLIST_ID and AUX_PLAYLIST_ID must be set');
  if (!process.env.LASTFM_API_KEY) throw new Error('LASTFM_API_KEY secret is not set');
  const api = await createClient();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const seeds = await getAllPlaylistTracks(api, SEEDS_ID);
  console.log(`Seeds: ${seeds.length} songs`);
  if (seeds.length === 0) throw new Error('The Aux Seeds playlist is empty: add a few songs first');
  const seedKeys = new Set(seeds.map(songKey));

  // Library, one copy of each song, seeds excluded
  const byKey = new Map();
  for (const l of LIBRARY) {
    if (!l.id) continue;
    for (const t of await getAllPlaylistTracks(api, l.id)) {
      const k = songKey(t);
      if (seedKeys.has(k) || !t.artists.length) continue;
      if (!byKey.has(k)) byKey.set(k, { ...t, key: k, lists: [l.name] });
      else if (!byKey.get(k).lists.includes(l.name)) byKey.get(k).lists.push(l.name);
    }
  }
  const library = [...byKey.values()];
  console.log(`Library: ${library.length} unique songs`);

  const lf = new LastFm(process.env.LASTFM_API_KEY, path.join(DATA_DIR, 'lastfm-cache.json'));
  const profile = await buildProfile(lf, seeds);
  console.log(`Profile: ${profile.artistSim.size} related artists, ${profile.trackSim.size} similar tracks, ${Object.keys(profile.tagProfile).length} tags`);
  const scored = await scoreLibrary(lf, library, profile, bangersScores());
  lf.save();
  console.log(`Last.fm requests this run: ${lf.calls}`);

  const doLastfm = ENGINE === 'lastfm' || ENGINE === 'both';
  const doClaude = ENGINE === 'claude' || ENGINE === 'both';

  if (doLastfm) {
    const picks = pickLastfm(scored, profile);
    await replacePlaylist(api, OUT_LASTFM, picks.map(s => s.uri));
    writeReport(path.join(DATA_DIR, 'aux-report-lastfm.md'), 'Aux playlist (Last.fm)', seeds, picks, profile);
    console.log(`Aux (Last.fm): ${picks.length} songs, ${picks.filter(s => s.stretch).length} stretch picks`);
  }

  if (doClaude) {
    if (!process.env.ANTHROPIC_API_KEY) console.log('Claude version skipped: ANTHROPIC_API_KEY secret is not set');
    else if (!OUT_CLAUDE) console.log('Claude version skipped: no AUX_CLAUDE_PLAYLIST_ID set');
    else {
      const picks = await pickClaude(scored, seeds, profile);
      await replacePlaylist(api, OUT_CLAUDE, picks.map(s => s.uri));
      writeReport(path.join(DATA_DIR, 'aux-report-claude.md'), 'Aux playlist (Claude)', seeds, picks, profile);
      console.log(`Aux (Claude): ${picks.length} songs, ${picks.filter(s => s.stretch).length} stretch picks`);
    }
  }
})().catch(err => {
  console.error('Aux run failed:', err.message);
  process.exit(1);
});
