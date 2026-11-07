// Create a multiple-choice vocabulary game from a language-learning-app
// chapter file (docs/games/game-planning.md → Phase 0).
//
// Usage (builds the server first so the generator is compiled):
//   npm run create:vocab-game -- [options]
//
// Options:
//   --source <file>     chapterNNData.json (default: the ch. 26 copy in server/src/games/content)
//   --skills <list>     reading,writing (default) — questions alternate in this order
//   --count <n>         number of questions (default 10)
//   --seed <n>          same seed → same questions and option order (default 26)
//   --title <text>      game title (default: "Ch. NN vocab: <skills>")
//   --server <url>      API base URL (default http://localhost:3000)
//   --creator <id>      createdByUserId (default the client's DEMO_CREATOR_ID)
//   --dry-run           print the questions without creating anything

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { generateVocabQuiz, termsFromChapter, toQuestionInput, vocabSkillValues } = require(
  join(repoRoot, 'dist/server/games/generators/vocab-choice.js'),
);

const DEMO_CREATOR_ID = '000000000000000000000001';

const { values: args } = parseArgs({
  options: {
    source: { type: 'string', default: join(repoRoot, 'server/src/games/content/chapter26Data.json') },
    skills: { type: 'string', default: 'reading,writing' },
    count: { type: 'string', default: '10' },
    seed: { type: 'string', default: '26' },
    title: { type: 'string' },
    server: { type: 'string', default: 'http://localhost:3000' },
    creator: { type: 'string', default: DEMO_CREATOR_ID },
    'dry-run': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const skills = args.skills.split(',').map((skill) => skill.trim()).filter(Boolean);
for (const skill of skills) {
  if (!vocabSkillValues.includes(skill)) {
    fail(`Unknown skill '${skill}'. Use: ${vocabSkillValues.join(', ')}.`);
  }
}
const count = Number(args.count);
const seed = Number(args.seed);
if (!Number.isInteger(count) || count < 1) fail('--count must be a positive integer.');
if (!Number.isInteger(seed)) fail('--seed must be an integer.');

const chapter = JSON.parse(readFileSync(args.source, 'utf8'));
const terms = termsFromChapter(chapter);
const items = generateVocabQuiz({ terms, skills, count, seed });
if (items.length < count) {
  console.warn(`Only ${items.length} of ${count} questions could be made from ${terms.length} terms.`);
}
const title = args.title ?? `Ch. ${chapter.chapter} vocab: ${skills.join(' + ')}`;
const questions = items.map((item, index) => ({ item, input: toQuestionInput(item, index + 1) }));

console.log(`${title}  (seed ${seed}, ${questions.length} questions)\n`);
for (const { item, input } of questions) {
  console.log(`Question ${input.sequence} (${item.skill}): ${input.text}`);
  for (const option of input.answerOptions) {
    console.log(`  ${option.slotLabel}. ${option.text}${option.isCorrect ? '   ✓' : ''}`);
  }
}

if (args['dry-run']) {
  process.exit(0);
}

async function post(path, body) {
  const url = `${args.server}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    fail(`Could not reach ${url}: ${error.message}. Is the server running (npm run dev)?`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(`POST ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

const { gameId } = await post('/api/games', { title, createdByUserId: args.creator });
for (const { input } of questions) {
  await post('/api/questions', { ...input, gameId, createdByUserId: args.creator });
}
console.log(`\nCreated game ${gameId} with ${questions.length} questions.`);
console.log(`Open it in the app: /games/${gameId}`);
