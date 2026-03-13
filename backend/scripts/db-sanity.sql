-- Counts
SELECT COUNT(*) AS users_total FROM users_rel;
SELECT COUNT(*) AS tx_total FROM transactions_rel;

-- Transactions per status
SELECT status, COUNT(*) AS tx_count
FROM transactions_rel
GROUP BY status
ORDER BY tx_count DESC;

-- Orphan transactions (no matching user)
SELECT t.id, t.userId
FROM transactions_rel t
LEFT JOIN users_rel u ON u.id = t.userId
WHERE u.id IS NULL
LIMIT 50;

-- Users with transaction counts and sums
SELECT
  u.id,
  u.email,
  COUNT(t.id) AS tx_count,
  COALESCE(SUM(t.amount), 0) AS tx_amount_sum
FROM users_rel u
LEFT JOIN transactions_rel t ON t.userId = u.id
GROUP BY u.id, u.email
ORDER BY tx_count DESC
LIMIT 50;

-- Recent transactions with user details
SELECT
  t.id AS tx_id,
  t.type,
  t.amount,
  t.status,
  t.createdAt,
  u.id AS user_pk,
  u.userId,
  u.email,
  u.fullName
FROM transactions_rel t
JOIN users_rel u ON u.id = t.userId
ORDER BY t.createdAt DESC
LIMIT 100;
