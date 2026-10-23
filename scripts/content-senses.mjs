// Build or check the word-sense registry for the Korean book
// (docs/xAPI/leitner-method.md → The sense registry).
//
// Usage (builds the server first so the registry code is compiled):
//   npm run content:senses -- [options]
//
// Reads every chapterNNData.json in the content folder, registers entries
// that aren't in the registry yet, and writes the registry back. Conflicts
// (a known word whose meaning matches no sense, or several) stop the run
// and nothing is written: resolve them by editing the registry file, either
// adding the sourceRef to an existing sense's `sources`, or adding a new
// sense for the word. Then run again.
//
// Options:
//   --content <dir>    chapter files (default server/src/games/content)
//   --registry <file>  registry (default <content>/korean-language-book-senses.json)
//   --book <key>       book id for a new registry (default korean-language-book)
//   --check            change nothing; exit 1 if the registry is out of date

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chapterVocabulary, emptySenseRegistry, updateSenseRegistry } = require(
  join(repoRoot, 'dist/server/learning/sense-registry.js'),
);

const { values: args } = parseArgs({
  options: {
    content: { type: 'string', default: join(repoRoot, 'server/src/games/content') },
    registry: { type: 'string' },
    book: { type: 'string', default: 'korean-language-book' },
    check: { type: 'boolean', default: false },
  },
});
const registryPath = args.registry ?? join(args.content, `${args.book}-senses.json`);

const chapterFiles = readdirSync(args.content)
  .map((name) => ({ name, number: Number(/^chapter(\d+)Data\.json$/.exec(name)?.[1]) }))
  .filter((file) => Number.isInteger(file.number))
  .sort((a, b) => a.number - b.number);
if (chapterFiles.length === 0) {
  console.error(`No chapterNNData.json files in ${args.content}.`);
  process.exit(1);
}

const chapters = chapterFiles.map((file) =>
  chapterVocabulary(JSON.parse(readFileSync(join(args.content, file.name), 'utf8'))),
);
const registry = existsSync(registryPath)
  ? JSON.parse(readFileSync(registryPath, 'utf8'))
  : emptySenseRegistry(args.book);

const { registry: next, added, attached, conflicts, problems } = updateSenseRegistry(registry, chapters);

for (const chapter of chapters) {
  const swapped = chapter.entries.filter((entry) => entry.swapped).length;
  const note = swapped > 0 ? `  (${swapped} entries had Korean/English swapped; read as swapped)` : '';
  console.log(`ch. ${chapter.chapter}: ${chapter.entries.length} entries${note}`);
}
const senseCount = Object.values(next.words).reduce((sum, senses) => sum + senses.length, 0);
console.log(`\n${Object.keys(next.words).length} words, ${senseCount} senses`);
console.log(`New senses: ${added.length}. Attached to an existing sense: ${attached.length}.`);
for (const { sourceRef, word, sense } of attached) {
  console.log(`  ${sourceRef} → ${word}/${sense}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
}
if (conflicts.length > 0) {
  console.error(`\n${conflicts.length} conflict(s) need a person to decide (edit ${registryPath}):`);
  for (const conflict of conflicts) {
    console.error(`  ${conflict.sourceRef}  ${conflict.word} = "${conflict.gloss}"`);
    for (const candidate of conflict.candidates) {
      console.error(`      existing sense '${candidate.sense}' = "${candidate.gloss}"  (${candidate.sources.join(', ')})`);
    }
    console.error(`      → add "${conflict.sourceRef}" to one sense's "sources", or add a new sense for this meaning.`);
  }
}
if (problems.length > 0 || conflicts.length > 0) {
  console.error('\nRegistry not written.');
  process.exit(1);
}

const changed = added.length + attached.length > 0;
if (args.check) {
  if (changed) {
    console.error(`\n${registryPath} is out of date. Run: npm run content:senses`);
    process.exit(1);
  }
  console.log('\nRegistry is up to date.');
  process.exit(0);
}
if (!changed) {
  console.log('\nRegistry is up to date; nothing written.');
  process.exit(0);
}
writeFileSync(registryPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`\nWrote ${registryPath}`);
