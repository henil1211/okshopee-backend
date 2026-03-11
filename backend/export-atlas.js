/**
 * STEP 1: Export data from MongoDB Atlas to JSON files
 * Run this on your LOCAL MACHINE (where Atlas works)
 *
 * Usage: node export-atlas.js
 * Output: Creates a 'data/atlas-export/' folder with JSON files
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ATLAS_URI = 'mongodb+srv://okshopee24_db_user:okshopee12345@cluster0.m8d0cnt.mongodb.net/okshopee24';
const DB_NAME = 'okshopee24';
const OUTPUT_DIR = join(__dirname, 'data', 'atlas-export');

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

async function exportAtlas() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Connecting to Atlas...');
  const client = new MongoClient(ATLAS_URI, {
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 120000,
    connectTimeoutMS: 60000
  });

  try {
    await client.connect();
    console.log('Connected to Atlas\n');
    const db = client.db(DB_NAME);
    let totalDocs = 0;

    for (const collName of COLLECTIONS) {
      try {
        const docs = await db.collection(collName).find({}).toArray();
        if (docs.length === 0) {
          console.log(`  ${collName}: empty, skipping`);
          continue;
        }
        const filePath = join(OUTPUT_DIR, `${collName}.json`);
        writeFileSync(filePath, JSON.stringify(docs, null, 0));
        totalDocs += docs.length;
        console.log(`  ${collName}: ${docs.length} docs exported`);
      } catch (error) {
        console.error(`  ${collName}: FAILED - ${error.message}`);
      }
    }

    console.log(`\nExport complete! ${totalDocs} documents saved to: ${OUTPUT_DIR}`);
    console.log('Now copy the "data/atlas-export" folder to your VPS and run: node import-local.js');
  } catch (error) {
    console.error('Export failed:', error.message);
  } finally {
    await client.close();
  }
}

exportAtlas();
