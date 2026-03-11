/**
 * Migration script: Copy all data from MongoDB Atlas to local MongoDB
 *
 * Usage: node migrate-atlas-to-local.js
 *
 * This reads all collections from your Atlas cluster and writes them
 * to your local MongoDB instance.
 */

import { MongoClient } from 'mongodb';

// === CONFIGURE THESE ===
const ATLAS_URI = 'mongodb+srv://okshopee24_db_user:okshopee12345@cluster0.m8d0cnt.mongodb.net/okshopee24';
const LOCAL_URI = 'mongodb://127.0.0.1:27017/okshopee24';
const DB_NAME = 'okshopee24';

// All collections to migrate
const COLLECTIONS = [
  'users', 'wallets', 'transactions', 'matrix', 'safety_pool',
  'grace_periods', 'reentries', 'notifications', 'settings',
  'payment_methods', 'payments', 'pins', 'pin_transfers',
  'pin_purchase_requests', 'support_tickets', 'otp_records',
  'email_logs', 'impersonation', 'help_trackers',
  'matrix_pending_contributions', 'safety_pool_transactions',
  'marketplace_categories', 'marketplace_retailers',
  'marketplace_banners', 'marketplace_deals',
  'marketplace_invoices', 'marketplace_redemptions',
  'state_meta', 'app_state'
];

async function migrate() {
  console.log('Connecting to Atlas...');
  const atlasClient = new MongoClient(ATLAS_URI, {
    serverSelectionTimeoutMS: 120000,
    socketTimeoutMS: 300000,
    connectTimeoutMS: 120000
  });

  console.log('Connecting to local MongoDB...');
  const localClient = new MongoClient(LOCAL_URI);

  try {
    await atlasClient.connect();
    console.log('Connected to Atlas');

    await localClient.connect();
    console.log('Connected to local MongoDB');

    const atlasDb = atlasClient.db(DB_NAME);
    const localDb = localClient.db(DB_NAME);

    let totalDocs = 0;

    for (const collName of COLLECTIONS) {
      try {
        const atlasColl = atlasDb.collection(collName);
        const docs = await atlasColl.find({}).toArray();

        if (docs.length === 0) {
          console.log(`  ${collName}: empty, skipping`);
          continue;
        }

        // Drop local collection first to avoid duplicates
        try {
          await localDb.collection(collName).drop();
        } catch {
          // Collection might not exist yet, that's fine
        }

        await localDb.collection(collName).insertMany(docs);
        totalDocs += docs.length;
        console.log(`  ${collName}: ${docs.length} documents migrated`);
      } catch (error) {
        console.error(`  ${collName}: FAILED - ${error.message}`);
      }
    }

    console.log(`\nMigration complete! Total: ${totalDocs} documents copied.`);
    console.log('You can now restart your backend with: pm2 restart all');

  } catch (error) {
    console.error('Migration failed:', error.message);
  } finally {
    await atlasClient.close();
    await localClient.close();
  }
}

migrate();
