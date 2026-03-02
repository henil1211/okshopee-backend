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
```
Use the same DB name in `MONGODB_DB` that you plan to inspect in MongoDB tools.

3. Run backend:
```bash
npm run dev
```

## API
- `GET /api/health`
- `GET /api/state`
- `POST /api/state`
- `GET /api/admin-audit`

## Storage Model
Data is stored as real documents in separate MongoDB collections, including:
- `users`, `wallets`, `transactions`, `matrix`
- `safety_pool` (summary snapshot) and `safety_pool_transactions` (one document per entry)
- `pins`, `pin_transfers`, `pin_purchase_requests`
- `payments`, `payment_methods`, `settings`
- `help_trackers`, `matrix_pending_contributions`
