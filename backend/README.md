# Backend (MongoDB)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure env vars in `.env`:
```env
PORT=4000
HOST=0.0.0.0
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=matrixmlm
MONGODB_LEGACY_SNAPSHOT_COLLECTION=app_state
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_IGNORE_TLS=false
SMTP_REQUIRE_TLS=false
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_FROM=your_smtp_user
```
Use the same DB name in `MONGODB_DB` that you plan to inspect in MongoDB tools.

For plain non-SSL SMTP, use:
```env
SMTP_PORT=25
SMTP_SECURE=false
SMTP_IGNORE_TLS=true
SMTP_REQUIRE_TLS=false
```

3. Run backend:
```bash
npm run dev
```

## API
- `GET /api/health`
- `GET /api/state`
- `POST /api/state`
- `GET /api/admin-audit`
- `POST /api/send-mail`

Example request:
```bash
curl -X POST http://127.0.0.1:4000/api/send-mail \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"receiver@example.com\",\"subject\":\"SMTP test\",\"text\":\"Email sent from backend SMTP\"}"
```

## Storage Model
Data is stored as real documents in separate MongoDB collections, including:
- `users`, `wallets`, `transactions`, `matrix`
- `safety_pool` (summary snapshot) and `safety_pool_transactions` (one document per entry)
- `pins`, `pin_transfers`, `pin_purchase_requests`
- `payments`, `payment_methods`, `settings`
- `help_trackers`, `matrix_pending_contributions`

## MySQL sanity helpers (Hostinger)

Run in phpMyAdmin (select DB `okshopee24` → SQL tab → paste file contents → Go). These are read-only checks.

## Full system backup (one-click)

Use this script to create a full backup package that includes:
- MySQL dumps (`full_database.sql` and `state_store_only.sql`)
- Backend API state backup metadata
- Backend runtime files (`data/backups`, `data/uploads`, state files)
- Env files (`backend/.env`, `frontend/.env`, `frontend/.env.production` if present)
- Source archive (frontend + backend without `node_modules`/`dist`)
- SHA256 checksum manifest

From repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\backend\scripts\full-system-backup.ps1
```

Optional flags:

```powershell
# Skip API backup request
powershell -ExecutionPolicy Bypass -File .\backend\scripts\full-system-backup.ps1 -SkipApiBackup

# Skip MySQL dump step
powershell -ExecutionPolicy Bypass -File .\backend\scripts\full-system-backup.ps1 -SkipMySqlDump

# Choose custom output root
powershell -ExecutionPolicy Bypass -File .\backend\scripts\full-system-backup.ps1 -OutputRoot "E:\SystemBackups"
```

Notes:
- The script reads `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` from `backend/.env` if you do not pass them explicitly.
- `mysqldump` must be installed and available in PATH unless you run with `-SkipMySqlDump`.
