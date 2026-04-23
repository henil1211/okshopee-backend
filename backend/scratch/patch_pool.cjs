
const fs = require('fs');
const path = require('path');

const targetFile = path.resolve('backend/server.js');
let content = fs.readFileSync(targetFile, 'utf8');

const oldConfig = `    connectionLimit: 50,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });`;

const newConfig = `    connectionLimit: 50,
    maxIdle: 10,
    idleTimeout: 10000,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 30000
  });`;

if (content.includes(oldConfig)) {
  console.log("Found old config, replacing...");
  content = content.replace(oldConfig, newConfig);
  fs.writeFileSync(targetFile, content);
  console.log("Replace success!");
} else {
  // Normalize whitespace as well just in case
  const normalize = (s) => s.replace(/\r\n/g, '\n').trim();
  const normalizedOld = normalize(oldConfig);
  
  if (normalize(content).includes(normalizedOld)) {
     console.log("Found old config (normalized), attempting line-by-line replacement...");
     // Very crude line by line replace for the pool block
     const lines = content.split(/\r?\n/);
     let startIndex = -1;
     for (let i = 0; i < lines.length; i++) {
       if (lines[i].includes('mysql.createPool({')) {
         startIndex = i;
         break;
       }
     }
     
     if (startIndex !== -1) {
       let endIndex = -1;
       for (let i = startIndex; i < startIndex + 20; i++) {
         if (lines[i].includes('});')) {
           endIndex = i;
           break;
         }
       }
       
       if (endIndex !== -1) {
         console.log(`Replacing lines ${startIndex+1} to ${endIndex+1}`);
         const poolBlock = [
           '  pool = mysql.createPool({',
           '    host: MYSQL_HOST,',
           '    port: MYSQL_PORT,',
           '    user: MYSQL_USER,',
           '    password: MYSQL_PASSWORD,',
           '    database: MYSQL_DATABASE,',
           '    waitForConnections: true,',
           '    connectionLimit: 50,',
           '    maxIdle: 10,',
           '    idleTimeout: 10000,',
           '    queueLimit: 0,',
           '    charset: \'utf8mb4\',',
           '    connectTimeout: 30000',
           '  });'
         ];
         lines.splice(startIndex, endIndex - startIndex + 1, ...poolBlock);
         fs.writeFileSync(targetFile, lines.join('\n'));
         console.log("Replace success (Line-by-Line)!");
       }
     } else {
        console.log("Could not find pool block start.");
     }
  } else {
    console.log("Could not find old config even normalized.");
  }
}
