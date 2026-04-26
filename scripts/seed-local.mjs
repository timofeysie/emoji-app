import mongoose from 'mongoose';

const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/emoji-app';

const ids = {
  teacherUserId: new mongoose.Types.ObjectId('000000000000000000000001'),
  studentUserId: new mongoose.Types.ObjectId('000000000000000000000002'),
  badgeId: new mongoose.Types.ObjectId('000000000000000000000003'),
};

async function run() {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  const db = mongoose.connection.db;

  await db.collection('users').updateOne(
    { _id: ids.teacherUserId },
    {
      $set: {
        displayName: 'Teacher Seed',
        authProviderId: 'seed-teacher-auth-provider-id',
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  await db.collection('users').updateOne(
    { _id: ids.studentUserId },
    {
      $set: {
        displayName: 'Student Seed',
        authProviderId: 'seed-student-auth-provider-id',
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  await db.collection('badges').updateOne(
    { _id: ids.badgeId },
    {
      $set: {
        externalBadgeId: 'seed-badge-001',
        label: 'Seed Badge 001',
        status: 'active',
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  console.log('Seed complete.');
  console.log(`teacherUserId=${ids.teacherUserId.toHexString()}`);
  console.log(`studentUserId=${ids.studentUserId.toHexString()}`);
  console.log(`badgeId=${ids.badgeId.toHexString()}`);
}

run()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
