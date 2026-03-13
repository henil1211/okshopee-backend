-- Quick sanity: counts and status breakdown only (no detail rows)

SELECT COUNT(*) AS users_total FROM users_rel;
SELECT COUNT(*) AS tx_total FROM transactions_rel;

SELECT status, COUNT(*) AS tx_count
FROM transactions_rel
GROUP BY status
ORDER BY tx_count DESC;

-- Orphan count (transactions without matching user)
SELECT COUNT(*) AS orphan_tx_count
FROM transactions_rel t
LEFT JOIN users_rel u ON u.id = t.userId
WHERE u.id IS NULL;
