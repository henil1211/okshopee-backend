# V2 Production Backend Design (Baseline Reset Strategy)

## 0) Context and Non-Negotiable Decision
You are not repairing historical corruption. You are freezing current balances as the new truth baseline, then guaranteeing correctness for all future operations.

Target stack:
- Node.js
- Express
- MySQL 8 (InnoDB only)

Critical objective:
- Future money inconsistencies become structurally impossible through backend authority, ACID transactions, idempotency, deterministic locking, and double-entry accounting.

Business requirement lock (explicit):
- Do NOT correct or reprice legacy wallet balances.
- Treat each current user wallet as-is at cutover (baseline truth), even if historically corrupted.
- Preserve old user help progression continuity (example: 5 + 5 receive, then mandatory 10 give) so flow does not reset or break.
- Fix only future operations by routing all financial actions through v2 atomic backend flows.

---

## 1) Core Principles and How They Are Enforced

1. Backend authoritative only
- All money mutations happen only through v2 backend endpoints.
- Frontend sends intent only, never balance updates.

2. Atomicity
- Every financial operation runs in a single DB transaction.
- If any step fails, full rollback.

3. No partial processing
- Ledger entries, wallet updates, business rows, idempotency finalization all inside one transaction.

4. Idempotency mandatory
- Every mutating request requires Idempotency-Key.
- Replays with same payload return same result.
- Replays with different payload are rejected.

5. Safe concurrency
- Row-level locks with SELECT ... FOR UPDATE.
- Deterministic lock order to avoid deadlocks.
- Retry policy for transient deadlocks.

6. Double-entry accounting
- Every posted transaction has balanced debit and credit lines.
- No direct wallet update without ledger.

---

## 2) Baseline Integration Model

## 2.1 Baseline Concept
At cutover time T0:
- Capture each user wallet amount as baseline amount.
- Store in v2_baseline_balances.
- Initialize v2_wallet_accounts.current_amount_cents = baseline_amount_cents.

## 2.2 Runtime Balance Formula
For each user wallet:
- Logical balance = baseline_amount_cents + v2_delta_from_ledger

Operationally, for speed and locking:
- Keep v2_wallet_accounts.current_amount_cents updated inside each committed transaction.
- Reconciliation checks that current_amount_cents equals baseline plus net ledger movement.

## 2.3 Separation from Legacy Corrupted Data
- Legacy tables remain untouched for history/reference.
- New system writes only to v2_* tables.
- Every v2 ledger transaction tagged with system_version = v2.
- No v2 code path reads legacy transaction tables for money calculations.

## 2.4 Help-Flow Continuity Baseline (Required)
Money baseline alone is not enough for business continuity. We must also snapshot each user's help progression state.

At T0, capture per user:
- current_stage_code (business stage currently in progress)
- receive_count_in_stage
- receive_total_cents_in_stage
- next_required_give_cents
- pending_give_cents (if any obligation already pending)
- last_progress_event_seq (for dedupe/order safety)

After cutover:
- v2 help engine reads this progression baseline.
- Next give/receive obligation is computed from this captured state.
- User flow continues exactly from current point, not from zero.

---

## 3) Production-Grade Database Schema

Use integer cents everywhere.
No floating point money.

~~~sql
CREATE TABLE v2_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  legacy_user_id VARCHAR(64) NULL,
  user_code VARCHAR(20) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NULL,
  status ENUM('active','blocked','closed') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_users_user_code (user_code),
  UNIQUE KEY uq_v2_users_legacy_user_id (legacy_user_id)
) ENGINE=InnoDB;

CREATE TABLE v2_gl_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_code VARCHAR(80) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  account_type ENUM('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY') NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  wallet_type ENUM('fund','income','royalty') NULL,
  is_system_account TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_gl_accounts_code (account_code),
  KEY idx_v2_gl_accounts_owner_wallet (owner_user_id, wallet_type),
  CONSTRAINT fk_v2_gl_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE v2_baseline_balances (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_type ENUM('fund','income','royalty') NOT NULL,
  baseline_amount_cents BIGINT NOT NULL,
  baseline_version INT NOT NULL,
  captured_at DATETIME(3) NOT NULL,
  captured_by VARCHAR(80) NOT NULL,
  snapshot_hash CHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_baseline_user_wallet_version (user_id, wallet_type, baseline_version),
  KEY idx_v2_baseline_active (is_active, baseline_version),
  CONSTRAINT fk_v2_baseline_user FOREIGN KEY (user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE v2_wallet_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_type ENUM('fund','income','royalty') NOT NULL,
  gl_account_id BIGINT UNSIGNED NOT NULL,
  baseline_amount_cents BIGINT NOT NULL,
  current_amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_wallet_user_wallet (user_id, wallet_type),
  UNIQUE KEY uq_v2_wallet_gl_account (gl_account_id),
  CONSTRAINT chk_v2_wallet_non_negative CHECK (current_amount_cents >= 0),
  CONSTRAINT fk_v2_wallet_user FOREIGN KEY (user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_wallet_gl FOREIGN KEY (gl_account_id) REFERENCES v2_gl_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE v2_help_progress_state (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  current_stage_code VARCHAR(40) NOT NULL,
  receive_count_in_stage INT UNSIGNED NOT NULL DEFAULT 0,
  receive_total_cents_in_stage BIGINT UNSIGNED NOT NULL DEFAULT 0,
  next_required_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pending_give_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_progress_event_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  baseline_snapshot_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_v2_help_progress_user FOREIGN KEY (user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE v2_idempotency_keys (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  endpoint_name VARCHAR(80) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('processing','completed','failed') NOT NULL,
  response_code INT NULL,
  response_body JSON NULL,
  error_code VARCHAR(80) NULL,
  locked_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_v2_idem_actor (actor_user_id),
  KEY idx_v2_idem_status_lock (status, locked_until),
  CONSTRAINT fk_v2_idem_actor FOREIGN KEY (actor_user_id) REFERENCES v2_users(id)
) ENGINE=InnoDB;

CREATE TABLE v2_ledger_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tx_uuid CHAR(36) NOT NULL,
  system_version VARCHAR(12) NOT NULL DEFAULT 'v2',
  tx_type ENUM('fund_transfer','pin_purchase','referral_credit','withdrawal_debit','admin_adjustment') NOT NULL,
  status ENUM('posted','reversed','void') NOT NULL DEFAULT 'posted',
  idempotency_key VARCHAR(128) NOT NULL,
  initiator_user_id BIGINT UNSIGNED NULL,
  reference_type VARCHAR(40) NULL,
  reference_id VARCHAR(80) NULL,
  description VARCHAR(255) NULL,
  total_debit_cents BIGINT UNSIGNED NOT NULL,
  total_credit_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  posted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_ledger_tx_uuid (tx_uuid),
  UNIQUE KEY uq_v2_ledger_idem (idempotency_key),
  KEY idx_v2_ledger_type_time (tx_type, created_at),
  KEY idx_v2_ledger_initiator (initiator_user_id),
  CONSTRAINT fk_v2_ledger_initiator FOREIGN KEY (initiator_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_ledger_idem FOREIGN KEY (idempotency_key) REFERENCES v2_idempotency_keys(idempotency_key),
  CONSTRAINT chk_v2_ledger_balanced CHECK (total_debit_cents = total_credit_cents)
) ENGINE=InnoDB;

CREATE TABLE v2_ledger_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ledger_txn_id BIGINT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  gl_account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  wallet_type ENUM('fund','income','royalty') NULL,
  entry_side ENUM('debit','credit') NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_v2_entries_txn_line (ledger_txn_id, line_no),
  KEY idx_v2_entries_account (gl_account_id),
  KEY idx_v2_entries_user_wallet (user_id, wallet_type),
  CONSTRAINT fk_v2_entries_txn FOREIGN KEY (ledger_txn_id) REFERENCES v2_ledger_transactions(id),
  CONSTRAINT fk_v2_entries_gl FOREIGN KEY (gl_account_id) REFERENCES v2_gl_accounts(id),
  CONSTRAINT fk_v2_entries_user FOREIGN KEY (user_id) REFERENCES v2_users(id),
  CONSTRAINT chk_v2_entries_amount_positive CHECK (amount_cents > 0)
) ENGINE=InnoDB;

CREATE TABLE v2_pins (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  pin_code CHAR(16) NOT NULL,
  buyer_user_id BIGINT UNSIGNED NOT NULL,
  price_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('generated','used','expired','cancelled') NOT NULL DEFAULT 'generated',
  purchased_txn_id BIGINT UNSIGNED NOT NULL,
  used_by_user_id BIGINT UNSIGNED NULL,
  used_txn_id BIGINT UNSIGNED NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  used_at DATETIME(3) NULL,
  UNIQUE KEY uq_v2_pins_code (pin_code),
  KEY idx_v2_pins_buyer_status (buyer_user_id, status),
  KEY idx_v2_pins_used_by (used_by_user_id),
  CONSTRAINT fk_v2_pins_buyer FOREIGN KEY (buyer_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_pins_purchase_txn FOREIGN KEY (purchased_txn_id) REFERENCES v2_ledger_transactions(id),
  CONSTRAINT fk_v2_pins_used_by FOREIGN KEY (used_by_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_pins_used_txn FOREIGN KEY (used_txn_id) REFERENCES v2_ledger_transactions(id)
) ENGINE=InnoDB;

CREATE TABLE v2_referral_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  event_key VARCHAR(140) NOT NULL,
  event_type ENUM('direct_referral','level_referral') NOT NULL,
  source_user_id BIGINT UNSIGNED NOT NULL,
  beneficiary_user_id BIGINT UNSIGNED NOT NULL,
  source_txn_id BIGINT UNSIGNED NULL,
  level_no SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  amount_cents BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','posted','skipped') NOT NULL DEFAULT 'pending',
  credit_txn_id BIGINT UNSIGNED NULL,
  reason VARCHAR(190) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  posted_at DATETIME(3) NULL,
  UNIQUE KEY uq_v2_ref_event_key (event_key),
  UNIQUE KEY uq_v2_ref_dedupe (source_txn_id, beneficiary_user_id, event_type, level_no),
  KEY idx_v2_ref_status (status, created_at),
  CONSTRAINT fk_v2_ref_source_user FOREIGN KEY (source_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_ref_beneficiary_user FOREIGN KEY (beneficiary_user_id) REFERENCES v2_users(id),
  CONSTRAINT fk_v2_ref_source_txn FOREIGN KEY (source_txn_id) REFERENCES v2_ledger_transactions(id),
  CONSTRAINT fk_v2_ref_credit_txn FOREIGN KEY (credit_txn_id) REFERENCES v2_ledger_transactions(id)
) ENGINE=InnoDB;
~~~

## 3.1 Required System GL Accounts
Create once:
- SYS_CASH_OR_SETTLEMENT (ASSET)
- SYS_PIN_REVENUE (REVENUE or LIABILITY depending recognition model)
- SYS_REFERRAL_EXPENSE (EXPENSE)
- SYS_ADJUSTMENT_SUSPENSE (EQUITY)

Each user wallet gets one liability account:
- USER_{user_code}_FUND
- USER_{user_code}_INCOME
- USER_{user_code}_ROYALTY

---

## 4) Baseline Cutover Procedure (Live-Safe)

## 4.1 Pre-Cutover
1. Keep user maintenance lock on.
2. Take full backup (DB + files).
3. Deploy v2 schema and read-only APIs.

## 4.2 Capture Baseline
Single cutover window:
1. Read current user balances from legacy source.
2. Insert into v2_users and v2_baseline_balances.
3. Create v2_gl_accounts for each user wallet.
4. Insert v2_wallet_accounts with:
- baseline_amount_cents = captured amount
- current_amount_cents = baseline amount
5. Capture help progression baseline into v2_help_progress_state.
6. Validate sample users for continuity rules (including users mid-stage with pending give obligations).

## 4.3 Post-Cutover Rule
- All financial mutations only through v2 endpoints/tables.
- Legacy transaction/balance tables become historical only.
- Legacy progression logic is read-only; v2_help_progress_state is now source of truth for future give/receive flow.

## 4.4 No-Correction Policy for Legacy Wallets
- V2 cutover must not adjust old wallet values.
- No historical backfill corrections are applied to user balances.
- Any discrepancy before T0 is accepted as part of baseline by business decision.
- Reconciliation alerts in v2 apply only to post-cutover v2 ledger consistency.

---

## 5) API Contract (Mutating Endpoints)

All mutating endpoints require:
- Authorization token
- Idempotency-Key header
- X-System-Version: v2

Endpoints:
- POST /api/v2/fund-transfers
- POST /api/v2/pins/purchase
- POST /api/v2/referrals/credit
- POST /api/v2/withdrawals

Authentication and authorization requirements (mandatory):
- Token must be validated server-side (signature, issuer, expiry).
- Token subject must match actor_user_id unless caller has admin role.
- Role checks are explicit per endpoint (user, admin, super-admin).
- Impersonation must include audit fields: impersonator_user_id, impersonated_user_id, reason, request_id.

Rate limiting (mandatory):
- Apply per user and per IP limits on all /api/v2 mutating endpoints.
- Use stricter limits for referral-credit and pin purchase endpoints.
- Enforce a dedicated cap on in-flight idempotency keys per actor.
- Return 429 with retry-after seconds when limit exceeded.

Any request without idempotency key or wrong version is rejected.

---

## 6) Detailed Financial Flows (Step-by-Step)

## 6.1 Shared Transaction Pattern
Used by every money mutation.

~~~sql
START TRANSACTION;

-- 1) Lock or create idempotency row
INSERT INTO v2_idempotency_keys (
  idempotency_key, endpoint_name, actor_user_id, request_hash, status, locked_until
) VALUES (?, ?, ?, ?, 'processing', DATE_ADD(NOW(3), INTERVAL 30 SECOND))
ON DUPLICATE KEY UPDATE
  last_seen_at = NOW(3);

SELECT idempotency_key, request_hash, status, response_code, response_body, locked_until
FROM v2_idempotency_keys
WHERE idempotency_key = ?
FOR UPDATE;

-- If status = completed and request_hash matches: return stored response, COMMIT.
-- If request_hash mismatches: reject 409, ROLLBACK.
-- If status = processing and locked_until > NOW(3): reject 409, ROLLBACK.
-- Else continue and refresh lock.

UPDATE v2_idempotency_keys
SET status = 'processing', locked_until = DATE_ADD(NOW(3), INTERVAL 30 SECOND)
WHERE idempotency_key = ?;

-- 2) Business logic and ledger posting happen here
-- 3) Save response in idempotency row

UPDATE v2_idempotency_keys
SET status = 'completed', response_code = ?, response_body = ?, locked_until = NULL
WHERE idempotency_key = ?;

COMMIT;
~~~

If any step fails:
- ROLLBACK
- Return error
- Optional: best-effort update idempotency row to failed outside transaction

---

## 6.2 Fund Transfer Flow (Sender to Receiver)

Inputs:
- sender_user_id
- receiver_user_code
- amount_cents
- idempotency_key

Validation:
1. sender != receiver
2. receiver exists and active
3. amount_cents > 0
4. sender has enough fund wallet balance

Locking order (deterministic):
- Lock both wallet rows ordered by wallet_account.id ascending

SQL sequence:

~~~sql
START TRANSACTION;

-- Shared idempotency pattern here

SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
FROM v2_wallet_accounts
WHERE user_id IN (?, ?) AND wallet_type = 'fund'
ORDER BY id
FOR UPDATE;

-- Validate sender balance in app layer from locked row

INSERT INTO v2_ledger_transactions (
  tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
  reference_type, reference_id, description, total_debit_cents, total_credit_cents
) VALUES (
  ?, 'v2', 'fund_transfer', 'posted', ?, ?,
  'fund_transfer', ?, ?, ?, ?
);

SET @ledger_txn_id = LAST_INSERT_ID();

-- Liability accounting:
-- sender wallet liability decreases => debit sender wallet liability
-- receiver wallet liability increases => credit receiver wallet liability
INSERT INTO v2_ledger_entries
  (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
VALUES
  (@ledger_txn_id, 1, ?, ?, 'fund', 'debit',  ?),
  (@ledger_txn_id, 2, ?, ?, 'fund', 'credit', ?);

UPDATE v2_wallet_accounts
SET current_amount_cents = current_amount_cents - ?, version = version + 1
WHERE user_id = ? AND wallet_type = 'fund' AND current_amount_cents >= ?;

-- Must affect 1 row, else insufficient funds

UPDATE v2_wallet_accounts
SET current_amount_cents = current_amount_cents + ?, version = version + 1
WHERE user_id = ? AND wallet_type = 'fund';

-- finalize idempotency row with response
COMMIT;
~~~

No partial state possible because ledger + balance updates are in same transaction.

---

## 6.3 Pin Purchase Flow

Inputs:
- buyer_user_id
- quantity
- unit_price_cents
- idempotency_key

Validation:
1. quantity > 0 and within configured max
2. total_amount = quantity * unit_price_cents
3. buyer fund balance sufficient

SQL sequence:

~~~sql
START TRANSACTION;

-- Shared idempotency pattern here

SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
FROM v2_wallet_accounts
WHERE user_id = ? AND wallet_type = 'fund'
FOR UPDATE;

-- Validate sufficient balance

INSERT INTO v2_ledger_transactions (
  tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
  reference_type, reference_id, description, total_debit_cents, total_credit_cents
) VALUES (
  ?, 'v2', 'pin_purchase', 'posted', ?, ?,
  'pin_purchase', ?, ?, ?, ?
);

SET @ledger_txn_id = LAST_INSERT_ID();

-- Debit user wallet liability, credit system pin revenue account
INSERT INTO v2_ledger_entries
  (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
VALUES
  (@ledger_txn_id, 1, ?, ?, 'fund', 'debit',  ?),
  (@ledger_txn_id, 2, ?, NULL, NULL, 'credit', ?);

UPDATE v2_wallet_accounts
SET current_amount_cents = current_amount_cents - ?, version = version + 1
WHERE user_id = ? AND wallet_type = 'fund' AND current_amount_cents >= ?;

-- Generate and insert pin rows in same transaction
-- pin_code collisions handled by unique key retry loop in app code

INSERT INTO v2_pins (pin_code, buyer_user_id, price_cents, status, purchased_txn_id, expires_at)
VALUES (?, ?, ?, 'generated', @ledger_txn_id, ?);

-- Repeat per quantity

-- finalize idempotency row
COMMIT;
~~~

If pin insert fails for any row, rollback reverses entire purchase.

Pin generation security requirements:
- pin_code must be generated using CSPRNG only.
- Minimum entropy target: 64 bits effective entropy.
- Never use timestamp-only or predictable incremental format.
- Keep unique key retry loop with bounded retries and failure alerting.

---

## 6.4 Referral/Income Credit Flow (Deduplicated)

Inputs:
- source_txn_id
- source_user_id
- beneficiary_user_id
- level_no
- amount_cents
- idempotency_key (or deterministic event key)

Deterministic dedupe key:
- REF:{source_txn_id}:{beneficiary_user_id}:{level_no}:{event_type}

SQL sequence:

~~~sql
START TRANSACTION;

-- Shared idempotency pattern or deterministic event-key lock

INSERT INTO v2_referral_events (
  event_key, event_type, source_user_id, beneficiary_user_id,
  source_txn_id, level_no, amount_cents, status
) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
ON DUPLICATE KEY UPDATE id = id;

SELECT id, status, credit_txn_id
FROM v2_referral_events
WHERE event_key = ?
FOR UPDATE;

-- If already posted, return success/no-op idempotently

SELECT id, gl_account_id, current_amount_cents
FROM v2_wallet_accounts
WHERE user_id = ? AND wallet_type = 'income'
FOR UPDATE;

INSERT INTO v2_ledger_transactions (
  tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
  reference_type, reference_id, description, total_debit_cents, total_credit_cents
) VALUES (
  ?, 'v2', 'referral_credit', 'posted', ?, ?,
  'referral_event', ?, ?, ?, ?
);

SET @ledger_txn_id = LAST_INSERT_ID();

-- Debit referral expense, credit beneficiary income wallet liability
INSERT INTO v2_ledger_entries
  (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
VALUES
  (@ledger_txn_id, 1, ?, NULL, NULL, 'debit',  ?),
  (@ledger_txn_id, 2, ?, ?, 'income', 'credit', ?);

UPDATE v2_wallet_accounts
SET current_amount_cents = current_amount_cents + ?, version = version + 1
WHERE user_id = ? AND wallet_type = 'income';

UPDATE v2_referral_events
SET status = 'posted', credit_txn_id = @ledger_txn_id, posted_at = NOW(3)
WHERE event_key = ?;

-- finalize idempotency row
COMMIT;
~~~

Duplicate credits are prevented by unique event key and idempotency.

---

## 6.5 Withdrawal Debit Flow

Inputs:
- actor_user_id
- amount_cents
- destination_type (bank|upi|wallet)
- destination_ref
- idempotency_key

Validation:
1. amount_cents > 0
2. actor wallet_type = income has sufficient balance
3. destination details pass format and allow-list checks
4. user is not blocked/closed

SQL sequence:

~~~sql
START TRANSACTION;

-- Shared idempotency pattern here

SELECT id, user_id, wallet_type, current_amount_cents, gl_account_id
FROM v2_wallet_accounts
WHERE user_id = ? AND wallet_type = 'income'
FOR UPDATE;

-- Validate sufficient income balance

INSERT INTO v2_ledger_transactions (
  tx_uuid, system_version, tx_type, status, idempotency_key, initiator_user_id,
  reference_type, reference_id, description, total_debit_cents, total_credit_cents
) VALUES (
  ?, 'v2', 'withdrawal_debit', 'posted', ?, ?,
  'withdrawal', ?, ?, ?, ?
);

SET @ledger_txn_id = LAST_INSERT_ID();

-- Debit user income wallet liability, credit system settlement account
INSERT INTO v2_ledger_entries
  (ledger_txn_id, line_no, gl_account_id, user_id, wallet_type, entry_side, amount_cents)
VALUES
  (@ledger_txn_id, 1, ?, ?, 'income', 'debit',  ?),
  (@ledger_txn_id, 2, ?, NULL, NULL, 'credit', ?);

UPDATE v2_wallet_accounts
SET current_amount_cents = current_amount_cents - ?, version = version + 1
WHERE user_id = ? AND wallet_type = 'income' AND current_amount_cents >= ?;

-- finalize idempotency row
COMMIT;
~~~

Failure handling:
- If payout orchestration is async, ledger posting remains source of truth and payout state is tracked separately.
- Any payout retry must use separate idempotent payout key, never repost financial debit.

---

## 6.6 Admin Adjustment Flow (Restricted)

Admin adjustments are emergency-only and must still be ledger-based.

Rules:
1. No direct UPDATE on wallet tables by admin tools.
2. Every adjustment requires reason_code, note, ticket_id, and approver_user_id.
3. Four-eyes control required for amounts above configured threshold.
4. Every adjustment writes immutable audit trail row with request payload hash.
5. Adjustment endpoint disabled by default in production.

Journal model:
- Debit/Credit between USER wallet liability and SYS_ADJUSTMENT_SUSPENSE.
- Post-adjustment reconciliation for affected user must pass before request closes.

---

## 6.7 Help Progression State Updates (Transactional Coupling)

Help progression state must update in the same transaction as related money event.

Mandatory rule:
- For give/receive events that change progression, update v2_help_progress_state inside the same DB transaction after wallet/ledger posting and before idempotency completion.

Concurrency and dedupe:
- Lock v2_help_progress_state row FOR UPDATE for the actor user.
- Reject stale/duplicate progression updates using last_progress_event_seq monotonic check.
- On rollback, progression and money both rollback together.

---

## 7) Double-Entry Integrity Controls

1. For each v2_ledger_transactions row:
- total_debit_cents must equal total_credit_cents.

2. For each posted transaction:
- At least two entries required.
- Sum(debit) equals sum(credit).

3. Wallet updates only allowed in transaction that also inserts ledger entries.

3.1. Non-negative wallet invariant:
- current_amount_cents must remain >= 0 (constraint + guarded UPDATE predicate).
- Any attempted violation is treated as a hard financial error and rolled back.

4. Nightly reconciliation job:
- Recompute expected wallet balances from baseline + ledger net.
- Compare with v2_wallet_accounts.current_amount_cents.
- Alert on non-zero diff.

Reconciliation query pattern:

~~~sql
SELECT
  wa.user_id,
  wa.wallet_type,
  wa.current_amount_cents AS current_cached,
  wa.baseline_amount_cents
  + COALESCE(SUM(
      CASE
        WHEN le.entry_side = 'credit' THEN le.amount_cents
        ELSE -le.amount_cents
      END
    ), 0) AS expected_from_ledger,
  wa.current_amount_cents
  - (
      wa.baseline_amount_cents
      + COALESCE(SUM(
          CASE
            WHEN le.entry_side = 'credit' THEN le.amount_cents
            ELSE -le.amount_cents
          END
        ), 0)
    ) AS diff_cents
FROM v2_wallet_accounts wa
LEFT JOIN v2_ledger_entries le
  ON le.gl_account_id = wa.gl_account_id
LEFT JOIN v2_ledger_transactions lt
  ON lt.id = le.ledger_txn_id
 AND lt.system_version = 'v2'
 AND lt.status = 'posted'
GROUP BY wa.user_id, wa.wallet_type, wa.current_amount_cents, wa.baseline_amount_cents
HAVING diff_cents <> 0;
~~~

---

## 8) Idempotency System (Exact Rules)

## 8.1 Key Generation
Client generates UUIDv7 and sends:
- Idempotency-Key: UUID

Server derives request_hash:
- SHA-256 of canonical JSON body + endpoint_name + actor_user_id

## 8.2 Processing Rules
1. First request with key:
- status becomes processing.

2. Retry with same key and same hash:
- If completed: return stored response.
- If processing and lock active: return 409 in progress.
- If processing but lock expired: reclaim and continue.

3. Retry with same key and different hash:
- Return 409 key-payload mismatch.

## 8.3 TTL and Cleanup
- Keep completed keys at least 7 days.
- Keep failed keys 24 hours.
- Scheduled cleanup job deletes expired idempotency rows.

---

## 9) Error Handling and Rollback Guarantees

For every mutating endpoint:
1. START TRANSACTION
2. Idempotency lock
3. Validate
4. Lock rows FOR UPDATE
5. Insert ledger tx + entries
6. Update wallet state
7. Save business artifacts
8. Mark idempotency completed
9. COMMIT

If any step fails:
- ROLLBACK immediately
- Return structured error
- No partial ledger, no partial wallet updates, no partial pin generation

Transient DB errors:
- For ER_LOCK_DEADLOCK and ER_LOCK_WAIT_TIMEOUT, retry transaction up to 3 times with jitter.

Permanent validation errors:
- No retry, return deterministic error.

---

## 10) Migration Safety Rules (Live System)

## 10.1 Prevent Legacy Interference
1. Disable legacy money write endpoints.
2. In generic state endpoints, block writes to financial keys when v2 is active.
3. Reject requests without X-System-Version: v2 on financial APIs.
4. Return 410 Gone for retired legacy financial endpoints.
5. Enforce allow-list: only explicitly approved non-financial legacy endpoints remain writable.
6. Add startup self-check that fails boot if legacy-write guard middleware is not mounted.

## 10.2 Database Permission Isolation
Use dedicated DB users:
- app_v2: full access only to v2_* tables.
- app_legacy: read-only for old financial tables.

This prevents accidental legacy writes by new backend code.

## 10.3 Feature Flags
Required flags:
- FINANCE_ENGINE_MODE = v2
- LEGACY_FINANCIAL_WRITES_ENABLED = false
- REQUIRE_IDEMPOTENCY_FOR_MUTATIONS = true
- REQUIRE_SYSTEM_VERSION_HEADER = true
- V2_RATE_LIMIT_ENABLED = true
- V2_MUTATION_RPM_PER_USER = 30
- V2_MUTATION_RPM_PER_IP = 120
- V2_IDEMPOTENCY_INFLIGHT_LIMIT_PER_USER = 10

## 10.4 Safe Cutover Sequence
1. Maintenance lock on.
2. Deploy v2 schema and code.
3. Capture baseline balances and initialize v2 wallet accounts.
4. Capture help progression baseline into v2_help_progress_state.
5. Run continuity validation for staged users (e.g., users who must give after next receive).
6. Enable v2 financial endpoints.
7. Disable legacy writes.
8. Run smoke tests with admin.
9. Reopen users after pass.

## 10.5 Post-Cutover Monitoring
Monitor continuously:
- wallet/ledger diff count
- duplicate idempotency collisions
- failed transaction rate
- deadlock retry count
- average lock wait time

Alert thresholds (initial defaults):
- wallet_ledger_diff_count > 0 for 5 minutes => P1 alert
- failed_transaction_rate >= 2% over 10 minutes => P1 alert
- deadlock_retry_rate >= 5% over 10 minutes => P2 alert
- idempotency_key_payload_mismatch > 0 => P1 alert
- avg_lock_wait_ms > 2000 for 10 minutes => P2 alert

Automatic protection actions:
- On sustained P1 for 15 minutes, switch financial APIs to maintenance mode (users blocked, admin only).
- Keep read APIs active for user visibility and support triage.

---

## 11) Express Service Structure (Recommended)

- src/modules/finance/controllers
- src/modules/finance/services
- src/modules/finance/repositories
- src/modules/finance/ledger
- src/modules/finance/idempotency
- src/modules/finance/reconciliation
- src/modules/finance/validators

Service-level hard rules:
- No repository method may update wallet balance outside active DB transaction context.
- Ledger post helper required for every financial mutation.
- Unit tests and integration tests for each flow.

---

## 12) Minimum Go-Live Checklist for V2

1. Baseline snapshot complete and signed.
2. v2 tables populated and indexed.
3. All 4 critical flows (transfer, pin, referral, withdrawal) run in transaction + idempotency + double-entry.
4. Legacy financial write paths disabled.
5. Admin adjustment endpoint locked by policy and audited.
6. Deadlock retry mechanism verified.
7. AuthN/AuthZ and impersonation audit checks verified on v2 endpoints.
8. Reconciliation go-live gate: zero unexplained diff for cutover window users.
9. Post-go-live SLO thresholds configured and alerting verified.
10. Rollback runbook tested.

If all ten pass, you can safely continue from maintenance to controlled reopen.
