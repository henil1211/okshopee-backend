-- V2 Phase A Seeding Verification Checks
-- Purpose: verify seeding completeness before switching to v2-only financial writes.
-- Pass condition: all detail queries return 0 rows AND all summary counts are 0.

SELECT 'START: V2 Phase A Seeding Verification' AS info, NOW() AS executed_at;

-- Check 1: active users missing any required wallet account (fund, income, royalty)
SELECT 'CHECK_1_MISSING_REQUIRED_WALLETS' AS check_name;
SELECT
  u.id,
  u.user_code,
  IF(f.id IS NULL, 1, 0) AS missing_fund,
  IF(i.id IS NULL, 1, 0) AS missing_income,
  IF(r.id IS NULL, 1, 0) AS missing_royalty
FROM v2_users u
LEFT JOIN v2_wallet_accounts f ON f.user_id = u.id AND f.wallet_type = 'fund'
LEFT JOIN v2_wallet_accounts i ON i.user_id = u.id AND i.wallet_type = 'income'
LEFT JOIN v2_wallet_accounts r ON r.user_id = u.id AND r.wallet_type = 'royalty'
WHERE u.status = 'active'
  AND (f.id IS NULL OR i.id IS NULL OR r.id IS NULL)
ORDER BY u.id;

-- Check 2: active users missing help progression seed row
SELECT 'CHECK_2_MISSING_HELP_PROGRESSION_STATE' AS check_name;
SELECT
  u.id,
  u.user_code
FROM v2_users u
LEFT JOIN v2_help_progress_state h ON h.user_id = u.id
WHERE u.status = 'active'
  AND h.user_id IS NULL
ORDER BY u.id;

-- Check 3: wallet accounts missing active baseline row
SELECT 'CHECK_3_MISSING_ACTIVE_BASELINE' AS check_name;
SELECT
  wa.user_id,
  wa.wallet_type
FROM v2_wallet_accounts wa
LEFT JOIN v2_baseline_balances bb
  ON bb.user_id = wa.user_id
 AND bb.wallet_type = wa.wallet_type
 AND bb.is_active = 1
WHERE bb.id IS NULL
ORDER BY wa.user_id, wa.wallet_type;

-- Check 4: users with no posted v2 ledger entries and wallet != baseline
SELECT 'CHECK_4_NO_POSTED_V2_LEDGER_AND_WALLET_BASELINE_MISMATCH' AS check_name;
SELECT
  u.user_code,
  wa.wallet_type,
  wa.current_amount_cents,
  bb.baseline_amount_cents
FROM v2_wallet_accounts wa
INNER JOIN v2_users u ON u.id = wa.user_id
INNER JOIN v2_baseline_balances bb
  ON bb.user_id = wa.user_id
 AND bb.wallet_type = wa.wallet_type
 AND bb.is_active = 1
WHERE NOT EXISTS (
  SELECT 1
  FROM v2_ledger_entries le
  INNER JOIN v2_ledger_transactions lt ON lt.id = le.ledger_txn_id
  WHERE le.gl_account_id = wa.gl_account_id
    AND lt.system_version = 'v2'
    AND lt.status = 'posted'
)
AND wa.current_amount_cents <> bb.baseline_amount_cents
ORDER BY u.user_code, wa.wallet_type;

-- Summary counts: all must be 0 for pass
SELECT 'SUMMARY_COUNTS' AS section_name;
SELECT
  (
    SELECT COUNT(*)
    FROM v2_users u
    LEFT JOIN v2_wallet_accounts f ON f.user_id = u.id AND f.wallet_type = 'fund'
    LEFT JOIN v2_wallet_accounts i ON i.user_id = u.id AND i.wallet_type = 'income'
    LEFT JOIN v2_wallet_accounts r ON r.user_id = u.id AND r.wallet_type = 'royalty'
    WHERE u.status = 'active'
      AND (f.id IS NULL OR i.id IS NULL OR r.id IS NULL)
  ) AS check_1_missing_required_wallets,
  (
    SELECT COUNT(*)
    FROM v2_users u
    LEFT JOIN v2_help_progress_state h ON h.user_id = u.id
    WHERE u.status = 'active'
      AND h.user_id IS NULL
  ) AS check_2_missing_help_progress_state,
  (
    SELECT COUNT(*)
    FROM v2_wallet_accounts wa
    LEFT JOIN v2_baseline_balances bb
      ON bb.user_id = wa.user_id
     AND bb.wallet_type = wa.wallet_type
     AND bb.is_active = 1
    WHERE bb.id IS NULL
  ) AS check_3_missing_active_baseline,
  (
    SELECT COUNT(*)
    FROM v2_wallet_accounts wa
    INNER JOIN v2_users u ON u.id = wa.user_id
    INNER JOIN v2_baseline_balances bb
      ON bb.user_id = wa.user_id
     AND bb.wallet_type = wa.wallet_type
     AND bb.is_active = 1
    WHERE NOT EXISTS (
      SELECT 1
      FROM v2_ledger_entries le
      INNER JOIN v2_ledger_transactions lt ON lt.id = le.ledger_txn_id
      WHERE le.gl_account_id = wa.gl_account_id
        AND lt.system_version = 'v2'
        AND lt.status = 'posted'
    )
    AND wa.current_amount_cents <> bb.baseline_amount_cents
  ) AS check_4_no_posted_v2_ledger_wallet_baseline_mismatch;

SELECT 'END: V2 Phase A Seeding Verification' AS info, NOW() AS executed_at;
