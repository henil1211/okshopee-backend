import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'okshopee24',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });

  try {
    const [rows] = await pool.query("SELECT store_key FROM state_store");
    console.log("Keys found in state_store:", rows.map(r => r.store_key));

    const [userRows] = await pool.query("SELECT store_value FROM state_store WHERE store_key = 'mlm_users'");
    if (userRows.length > 0) {
      const users = JSON.parse(userRows[0].store_value);
      console.log("Total users:", users.length);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
