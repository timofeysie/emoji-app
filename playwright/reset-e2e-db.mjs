// Drops the e2e database before the e2e API server starts (playwright.config.ts).
// It runs before the server, not in globalSetup: Playwright starts webServer
// first, and dropping after the server's syncIndexes() would lose the indexes.
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('[e2e] MONGODB_URI is not set.');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
try {
  await client.connect();
  const db = client.db();
  if (!db.databaseName.endsWith('-e2e')) {
    console.error(`[e2e] Refusing to drop '${db.databaseName}': not an -e2e database.`);
    process.exit(1);
  }
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName) {
    console.error(
      '[e2e] MongoDB is not a replica set, so guesses (transactions) will fail. See docs/db/mongo.md.',
    );
    process.exit(1);
  }
  await db.dropDatabase();
  console.log(`[e2e] Dropped ${db.databaseName}.`);
} catch (error) {
  console.error(
    `[e2e] Cannot reach MongoDB at ${uri}. Start the local replica set (docs/db/mongo.md).\n${error}`,
  );
  process.exit(1);
} finally {
  await client.close();
}
