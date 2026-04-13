const http = require('http');

const payload = {
    state: {
        mlm_transactions: "[]"
    },
    baseUpdatedAt: "2023-01-01T00:00:00.000Z"
};

const req = http.request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/state?force=1&chunk=1',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    }
}, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
    });
});

req.on('error', console.error);
req.write(JSON.stringify(payload));
req.end();
