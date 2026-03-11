/**
 * STEP 2: Import JSON files into local MongoDB
 * Run this on your VPS (where local MongoDB is running)
 *
 * Usage: node import-local.js
 * Reads from: data/atlas-export/ folder
 */

import { MongoClient } from 'mongodb';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_URI = 'mongodb://127.0.0.1:27017/okshopee24';
const DB_NAME = 'okshopee24';
const INPUT_DIR = join(__dirname, 'data', 'atlas-export');

async function importLocal() {
  console.log('Connecting to local MongoDB...');
  const client = new MongoClient(LOCAL_URI);

  try {
    await client.connect();
    console.log('Connected to local MongoDB\n');
    const db = client.db(DB_NAME);
    let totalDocs = 0;

    const files = readdirSync(INPUT_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      console.error('No JSON files found in', INPUT_DIR);
      console.error('Make sure you copied the atlas-export folder from your local machine.');
      return;
    }

    for (const file of files) {
      const collName = basename(file, '.json');
      try {
        const raw = readFileSync(join(INPUT_DIR, file), 'utf-8');
        const docs = JSON.parse(raw);
        if (!Array.isArray(docs) || docs.length === 0) {
          console.log(`  ${collName}: empty, skipping`);
          continue;
        }

        // Drop existing collection to avoid duplicates
        try {
          await db.collection(collName).drop();
        } catch {
          // Collection might not exist yet
        }

        await db.collection(collName).insertMany(docs);
        totalDocs += docs.length;
        console.log(`  ${collName}: ${docs.length} docs imported`);
      } catch (error) {
        console.error(`  ${collName}: FAILED - ${error.message}`);
      }
    }

    console.log(`\nImport complete! ${totalDocs} documents imported.`);
    console.log('Now restart your backend with: pm2 restart all');
  } catch (error) {
    console.error('Import failed:', error.message);
  } finally {
    await client.close();
  }
}

importLocal();
