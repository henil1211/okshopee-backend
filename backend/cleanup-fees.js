import { MongoClient } from 'mongodb';

async function check() {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('matrixmlm_local');

  // Find system_fee docs directly
  const feeDocs = await db.collection('transactions').find({ type: 'system_fee' }).limit(3).toArray();
  console.log('system_fee docs found:', feeDocs.length);
  if (feeDocs.length > 0) {
    console.log('Sample _id:', feeDocs[0]._id);
    console.log('Sample keys:', Object.keys(feeDocs[0]));
  }

  // Just delete them directly
  const deleteResult = await db.collection('transactions').deleteMany({ type: 'system_fee' });
  console.log('Deleted:', deleteResult.deletedCount, 'system_fee documents');

  // Verify
  const remaining = await db.collection('transactions').countDocuments({ type: 'system_fee' });
  console.log('Remaining system_fee:', remaining);
  console.log('Total transactions:', await db.collection('transactions').countDocuments({}));

  await client.close();
}

check().catch(console.error);
