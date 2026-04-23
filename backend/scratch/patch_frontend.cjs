
const fs = require('fs');
const path = require('path');

const filesToFix = [
  'frontend/src/store/index.ts',
  'frontend/src/db/index.ts',
  'frontend/src/pages/Admin.tsx'
];

filesToFix.forEach(relPath => {
  const targetFile = path.resolve(relPath);
  if (!fs.existsSync(targetFile)) {
    console.log(`Skipping ${relPath} (not found)`);
    return;
  }
  
  let content = fs.readFileSync(targetFile, 'utf8');
  let originalLen = content.length;
  
  // Replace 30000, 25000, 15000 with 60000 where likely relevant to timeouts
  // Using Regex to be safe about surrounding context
  // Matches "30000" or 30000
  content = content.replace(/:\s*(30000|25000|15000|10000)(\s|,|;|\n|\)|$)/g, ': 60000$2');
  content = content.replace(/=\s*(30000|25000|15000|10000)(\s|,|;|\n|\)|$)/g, '= 60000$2');
  content = content.replace(/timeoutMs\s*=\s*(30000|25000|15000|10000)/g, 'timeoutMs = 60000');
  content = content.replace(/timeout\s*=\s*(30000|25000|15000|10000)/g, 'timeout = 60000');
  
  // Also specific for store/index.ts defaults
  content = content.replace(/timeoutMs\s*:\s*60000/g, 'timeoutMs: 60000');
  
  if (content.length !== originalLen || content !== fs.readFileSync(targetFile, 'utf8')) {
    fs.writeFileSync(targetFile, content);
    console.log(`Successfully updated timeouts in ${relPath}`);
  } else {
    console.log(`No timeouts needed update in ${relPath}`);
  }
});

// Specific fix for db/index.ts constant
const dbFile = path.resolve('frontend/src/db/index.ts');
if (fs.existsSync(dbFile)) {
    let content = fs.readFileSync(dbFile, 'utf8');
    content = content.replace(/REMOTE_SYNC_REQUEST_TIMEOUT_MS\s*=\s*10_000/g, 'REMOTE_SYNC_REQUEST_TIMEOUT_MS = 60000');
    fs.writeFileSync(dbFile, content);
    console.log(`Updated REMOTE_SYNC_REQUEST_TIMEOUT_MS in db/index.ts`);
}
