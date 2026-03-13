-- Wallet/transaction consistency spot-checks
-- Adjust TYPE filters if you add new transaction types.

-- Total amounts per transaction type (helps spot sign issues)
SELECT type, COUNT(*) AS tx_count, SUM(amount) AS amount_sum
FROM transactions_rel
GROUP BY type
ORDER BY tx_count DESC;

-- Per-user aggregate: top 20 by absolute tx amount
SELECT
  u.id        AS user_pk,
  u.userId    AS user_code,
  u.email,
  COUNT(t.id) AS tx_count,
  SUM(t.amount) AS amount_sum
FROM users_rel u
LEFT JOIN transactions_rel t ON t.userId = u.id
GROUP BY u.id, u.userId, u.email
ORDER BY ABS(SUM(COALESCE(t.amount,0))) DESC
LIMIT 20;

-- Completed vs non-completed counts (in case new statuses appear)
SELECT status, COUNT(*) AS tx_count, SUM(amount) AS amount_sum
FROM transactions_rel
GROUP BY status;
