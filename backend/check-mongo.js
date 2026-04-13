import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';

async function check() {
  const client = new MongoClient(uri);
  await client.connect();

  // List all databases
  const dbs = await client.db().admin().listDatabases();
  console.log('Databases:', dbs.databases.map(d => d.name));

  // Check each DB for transactions
  for (const dbInfo of dbs.databases) {
    const db = client.db(dbInfo.name);
    const collections = await db.listCollections().toArray();
    const collNames = collections.map(c => c.name);
    if (collNames.length > 0 && !['admin', 'local', 'config'].includes(dbInfo.name)) {
      console.log(`\n${dbInfo.name} collections:`, collNames);
      for (const col of collNames) {
        const count = await db.collection(col).countDocuments({});
        if (count > 0) console.log(`  ${col}: ${count} docs`);
      }
    }
  }

  await client.close();
}

check().catch(console.error);
