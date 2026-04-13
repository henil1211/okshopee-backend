const url = "https://api.refernex.com/api/state?force=1&chunk=1";
const body = '{"state":{"mlm_wallets":"{"}}';

fetch(url, {
    method: "POST",
    body: body,
    headers: { "Content-Type": "application/json" }
}).then(r => r.text().then(t => console.log(r.status, t)))
    .catch(console.error);
