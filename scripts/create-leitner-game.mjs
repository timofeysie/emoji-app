// Plan and create a student's next solo Leitner game
// (docs/xAPI/leitner-method.md → The create:leitner-game script).
//
// A thin client of GET /api/players/:id/progress and POST /api/leitner-games,
// so the app and this script always make the same game. Needs the server
// running (npm run dev) with the LRS configured.
//
// Usage:
//   npm run create:leitner-game -- --player <playerId|externalId> [options]
//
// Options:
//   --chapter <n>      default 27
//   --book <key>       default korean-language-book
//   --scope <s>        chapter (default) | review
//   --aspects <list>   reading,writing (default)
//   --count <n>        default 10
//   --max-new <n>      default 4 (fill can add more when there's nothing to practise)
//   --no-fill          shorter game instead of practice and new-word fill
//   --seed <n>         default: server-derived (printed)
//   --now <iso>        pretend it's this time (testing the schedule)
//   --server <url>     default http://localhost:3000
//   --creator <id>     createdByUserId (default the client's DEMO_CREATOR_ID)
//   --report           progress table only
//   --dry-run          progress table + planned questions, create nothing
//
// Takes a player ID, not a first name, to keep names out of shell history.

import { parseArgs } from 'node:util';

const DEMO_CREATOR_ID = '000000000000000000000001';

const { values: args } = parseArgs({
  options: {
    player: { type: 'string' },
    chapter: { type: 'string', default: '27' },
    book: { type: 'string', default: 'korean-language-book' },
    scope: { type: 'string', default: 'chapter' },
    aspects: { type: 'string', default: 'reading,writing' },
    count: { type: 'string', default: '10' },
    'max-new': { type: 'string', default: '4' },
    'no-fill': { type: 'boolean', default: false },
    seed: { type: 'string' },
    now: { type: 'string' },
    server: { type: 'string', default: 'http://localhost:3000' },
    creator: { type: 'string', default: DEMO_CREATOR_ID },
    report: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

function integer(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} must be a non-negative integer.`);
  return n;
}

if (!args.player) fail('--player <playerId|externalId> is required.');
if (!['chapter', 'review'].includes(args.scope)) fail('--scope must be chapter or review.');
const aspects = args.aspects.split(',').map((a) => a.trim()).filter(Boolean);

async function call(method, path, body) {
  const url = `${args.server}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    fail(`Could not reach ${url}: ${error.message}. Is the server running (npm run dev)?`);
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function resolvePlayerId(value) {
  if (/^[a-f0-9]{24}$/i.test(value)) return value;
  const { status, json } = await call('GET', '/api/players');
  if (status !== 200) fail(`GET /api/players failed (${status}): ${JSON.stringify(json)}`);
  const match = json.players.find((p) => p.externalId === value);
  if (!match) fail(`No player with id or externalId '${value}'.`);
  return match.id;
}

const playerId = await resolvePlayerId(args.player);

// ── Progress table ──────────────────────────────────────────────────────────
const query = new URLSearchParams({ chapter: args.chapter, book: args.book, scope: args.scope, aspects: aspects.join(',') });
if (args.now) query.set('now', args.now);
const progress = await call('GET', `/api/players/${playerId}/progress?${query}`);
if (progress.status !== 200) fail(`Progress failed (${progress.status}): ${JSON.stringify(progress.json)}`);
const p = progress.json;

const mmdd = (iso) => iso.slice(5, 10);
function cell(track) {
  if (!track) return '';
  if (track.status === 'retired') return '★ retired';
  if (track.status === 'new') return 'new';
  const dots = '●'.repeat(track.level) + '○'.repeat(3 - track.level);
  const due = track.due ? 'due now' : `due ${mmdd(track.dueAt)}`;
  return `${dots} L${track.level} ${due}${track.lastResult === 'incorrect' ? ' ✗' : ''}`;
}
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - [...text].length));

function table(tracks) {
  const rows = new Map();
  for (const track of tracks) {
    const row = rows.get(track.learningObjectId) ?? { label: `${track.word ?? '?'} ${track.gloss ?? ''}`, cells: {}, sources: track.sources };
    row.cells[track.aspect] = track;
    rows.set(track.learningObjectId, row);
  }
  const labelWidth = Math.min(28, Math.max(...[...rows.values()].map((r) => [...r.label].length), 10)) + 2;
  console.log(pad('', labelWidth) + aspects.map((a) => pad(a, 20)).join(''));
  for (const row of rows.values()) {
    const otherChapters = (row.sources ?? [])
      .map((ref) => /\/ch(\d+)\//.exec(ref)?.[1])
      .filter((ch) => ch && ch !== String(args.chapter));
    const note = otherChapters.length > 0 ? `(also ch. ${[...new Set(otherChapters)].join(', ')})` : '';
    console.log(pad(row.label.slice(0, labelWidth - 2), labelWidth) + aspects.map((a) => pad(cell(row.cells[a]), 20)).join('') + note);
  }
}

console.log(`${p.player.label} · ${p.book} ch. ${p.chapter} · scope: ${p.scope === 'review' ? 'chapter + review' : 'chapter'} · as of ${p.asOf.slice(0, 16).replace('T', ' ')}`);
table(p.tracks.filter((t) => t.inChapter));
const s = p.summary;
const active = Object.values(s.active).reduce((a, b) => a + b, 0);
const review = p.tracks.filter((t) => !t.inChapter);
console.log(`\nch. ${p.chapter}: ${s.new} new · ${active} active · ${s.retired} retired · ${s.due} due` + (review.length ? `     review: ${review.filter((t) => t.due).length} due` : ''));
if (p.pendingExport.length > 0) {
  console.log(`⚠ ${p.pendingExport.length} Leitner game(s) waiting for export: ${p.pendingExport.map((g) => g.gameId).join(', ')}`);
}

if (args.report) process.exit(0);

// ── Plan / create ───────────────────────────────────────────────────────────
const body = {
  playerId,
  book: args.book,
  chapter: args.chapter,
  scope: args.scope,
  aspects,
  count: integer('count', args.count),
  maxNew: integer('max-new', args['max-new']),
  fill: !args['no-fill'],
  ...(args.seed !== undefined ? { seed: integer('seed', args.seed) } : {}),
  ...(args.now ? { now: args.now } : {}),
  ...(args['dry-run'] ? { dryRun: true } : { createdByUserId: args.creator }),
};
const { status, json } = await call('POST', '/api/leitner-games', body);
if (status !== 200 && status !== 201) {
  fail(`\nPOST /api/leitner-games failed (${status}): ${JSON.stringify(json, null, 2)}`);
}
const plan = json.plan;
const r = plan.report;
console.log(
  `\nPicked ${plan.picks.length}: ${r.picked.overdue} overdue, ${r.picked.review} review, ${r.picked.new} new, ${r.picked.practice} practice   (seed ${plan.seed})`,
);
for (const skip of r.skipped) console.log(`  skipped ${skip.learningObjectId} ${skip.aspect}: ${skip.why}`);
if (plan.picks.length === 0) console.log('Nothing to ask: try --scope review or the next chapter.');

if (args['dry-run']) {
  for (const q of plan.questions) {
    console.log(`\nQuestion ${q.sequence} (${q.aspect}): ${q.prompt}`);
    for (const option of q.options) console.log(`  ${option.slotLabel}. ${option.text}${option.isCorrect ? '   ✓' : ''}`);
  }
  if (plan.supersedes.length > 0) console.log(`\nCreating would delete unplayed game(s): ${plan.supersedes.join(', ')}`);
  process.exit(0);
}

console.log(`\nCreated game ${json.gameId} with ${plan.questions.length} questions.`);
if (plan.supersedes.length > 0) console.log(`Deleted unplayed game(s): ${plan.supersedes.join(', ')}`);
console.log(`Open it in the app: /games/${json.gameId}`);
