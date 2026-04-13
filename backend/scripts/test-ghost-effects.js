import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function resolveUserByRef(ref, users) {
  return users.find(u => u.id === ref || u.userId === ref);
}

async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    waitForConnections: true,
  });

  try {
    const [usersRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_users'");
    const [txsRow] = await pool.query("SELECT state_value FROM state_store WHERE state_key = 'mlm_transactions'");

    let users = JSON.parse(usersRow[0].state_value || '[]');
    let transactions = JSON.parse(txsRow[0].state_value || '[]');

    const validUserIds = new Set(users.map(u => u.userId));
    const validInternalIds = new Set(users.map(u => u.id));

    let ghostRecipients = new Set();
    for (const tx of transactions) {
      let isGhost = false;
      if (tx.type === 'receive_help' || tx.type === 'direct_income') {
        if (tx.fromUserId && !validUserIds.has(tx.fromUserId) && !validInternalIds.has(tx.fromUserId)) {
          isGhost = true;
        }
        const match = String(tx.description || '').match(/\((\d{7})\)/);
        if (match && !validUserIds.has(match[1])) {
          isGhost = true;
        }
      }
      if (isGhost) {
         ghostRecipients.add(tx.userId);
      }
    }

    console.log(`Found ${ghostRecipients.size} users who received ghost income.`);
    
    for (const uid of Array.from(ghostRecipients).slice(0, 3)) {
       const user = resolveUserByRef(uid, users);
       console.log(`\nUser: ${user?.fullName} (${user?.userId})`);
       const userTxs = transactions.filter(tx => tx.userId === uid || tx.userId === user?.userId);
       
       userTxs.sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
       for (const tx of userTxs) {
          console.log(`  [${new Date(tx.createdAt).toISOString()}] ${tx.type} | Amt: ${tx.amount} | Desc: ${tx.description} | Status: ${tx.status}`);
       }
       
       // did they give help?
       const given = transactions.filter(tx => tx.type === 'give_help' && (tx.userId === uid || tx.userId === user?.userId));
       console.log(`  -> Sent Give Helps:`);
       for (const gtx of given) {
          console.log(`     Amt: ${gtx.amount} | Desc: ${gtx.description} | toUser: ${resolveUserByRef(gtx.toUserId, users)?.userId}`);
       }
    }

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
