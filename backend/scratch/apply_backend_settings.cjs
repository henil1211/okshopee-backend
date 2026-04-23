const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. SMTP Timeout 8000 -> 15000
content = content.replace(/process\.env\.SMTP_TIMEOUT_MS\s*\|\|\s*8000\s*\)/g, 'process.env.SMTP_TIMEOUT_MS || 15000)');
content = content.replace(/TIMEOUT_MS_RAW\s*>\s*0\s*\?\s*SMTP_TIMEOUT_MS_RAW\s*:\s*8000/g, 'TIMEOUT_MS_RAW > 0 ? SMTP_TIMEOUT_MS_RAW : 15000');

// 2. V2_TX_RETRY_MAX_ATTEMPTS 3 -> 5
content = content.replace(/process\.env\.V2_TX_RETRY_MAX_ATTEMPTS\s*\|\|\s*3\s*\)/g, 'process.env.V2_TX_RETRY_MAX_ATTEMPTS || 5)');
content = content.replace(/V2_TX_RETRY_MAX_ATTEMPTS_RAW\s*<=\s*5/g, 'V2_TX_RETRY_MAX_ATTEMPTS_RAW <= 10');
content = content.replace(/\?\s*Math\.trunc\(V2_TX_RETRY_MAX_ATTEMPTS_RAW\)\s*:\s*3/g, '? Math.trunc(V2_TX_RETRY_MAX_ATTEMPTS_RAW) : 5');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Backend timeout adjustments applied.');
