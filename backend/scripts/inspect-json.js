import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  try {
    const rawData = await fs.readFile(path.join(__dirname, '..', 'data', 'app-state.local.json'), 'utf-8');
    const db = JSON.parse(rawData);
    const transactions = db.mlm_transactions || [];
    const users = db.mlm_users || [];

    const ghostReceives = transactions.filter(tx => {
       if (tx.type !== 'receive_help') return false;
       const sender = users.find(u => u.id === tx.fromUserId || u.userId === tx.fromUserId);
       return !sender;
    });

    console.log(`Found ${ghostReceives.length} ghost receives.`);
    
    if (ghostReceives.length > 0) {
       const userIdsWithGhosts = [...new Set(ghostReceives.map(tx => tx.userId))];
       console.log(`Users with ghosts:`, userIdsWithGhosts.slice(0, 3));
       
       for (const uid of userIdsWithGhosts.slice(0, 3)) {
          const userTxs = transactions.filter(tx => tx.userId === uid);
          console.log(`\nTransactions for user ${uid}:`);
          
          userTxs.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          for (const tx of userTxs) {
             console.log(`  [${tx.createdAt}] ${tx.type} | Amt: ${tx.amount} | Desc: ${tx.description}`);
          }
       }
    }

  } catch (e) {
    console.error(e);
  }
}

run();
