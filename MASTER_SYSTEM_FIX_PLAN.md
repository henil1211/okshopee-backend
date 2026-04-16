# Master System Fix Plan (Incremental, No Big-Bang Rewrite)

## 1) Goal
Stabilize and correct the full system end-to-end (auth, financial logic, matrix, wallets, admin flows, sync) using safe, phased changes with rollback at every stage.

This plan is designed to avoid a risky full rewrite. We will use an incremental migration strategy with strict validation gates.

## 2) Current Baseline (Already Completed)
- Maintenance lock is active for normal users.
- Admin access remains available.
- Full backup process has been set up and validated.
- Recent maintenance lock changes are already pushed to `main`.

## 3) Guardrails (Must Not Break)
1. No direct production edits without backup + verification.
2. Every phase must end with a checkpoint and approval before the next phase.
3. Financial state changes must become server-authoritative (frontend cannot be source of truth for money logic).
4. Keep admin operations functional throughout migration.
5. Keep rollback path for each phase.

## 4) Execution Strategy
Use a "strangler" approach:
- Keep existing system running.
- Move one critical capability at a time to hardened backend APIs.
- Add validation and reconciliation after each move.
- Remove old fragile logic only after parity is proven.

## 5) Phase Plan

## Phase 0: Safety + Freeze Control (Day 0)
### Scope
- Confirm backup artifacts are restorable.
- Confirm maintenance lock works for non-admin users.
- Define change log and incident log files.

### Deliverables
- Backup verification checklist signed.
- Execution journal file for all changes.

### Exit Gate
- Backup restore dry-run passes.
- Admin can still login and impersonate.

### Rollback
- Restore from latest DB + file backup and redeploy prior commit.

---

## Phase 1: Data Truth and Integrity Audit (Day 1)
### Scope
- Produce authoritative snapshot of users, wallets, transactions, matrix, pins.
- Detect and classify inconsistencies (duplicate credits, orphan records, broken links, stale derived balances).

### Tasks
1. Build audit scripts to generate:
   - wallet-vs-ledger mismatch report
   - matrix parent/child integrity report
   - sponsor/direct counts verification
   - state_store vs relational table parity report (where applicable)
2. Freeze reconciliation rules document (what is expected for each transaction type).

### Deliverables
- `/reports/audit-baseline-<timestamp>.json`
- Reconciliation rulebook markdown.

### Exit Gate
- All inconsistencies are categorized as:
  - safe-auto-fix
  - manual-review
  - ignore-with-reason

### Rollback
- No data mutation in this phase, so no rollback required.

---

## Phase 2: Financial Engine Hardening (Day 1-2)
### Scope
- Ensure wallet balances are derived from valid ledger events, not accidental frontend state mutations.

### Tasks
1. Define canonical transaction model and invariants.
2. Add backend-side validation for all money-impacting actions.
3. Prevent duplicate application of credits/debits (idempotency keys).
4. Add backend reconciliation endpoint:
   - recompute wallet from ledger
   - compare and report delta
   - optional controlled repair mode
5. Mark unsafe legacy client-side paths as deprecated and gate them.

### Deliverables
- Backend endpoints for validation + reconciliation.
- Financial invariants test suite.

### Exit Gate
- Reconciliation produces zero unexplained mismatch on baseline dataset.
- Duplicate/replay attempts are rejected safely.

### Rollback
- Disable new validation endpoints via feature flag and revert commit if needed.

---

## Phase 3: Auth and Access Model Cleanup (Day 2)
### Scope
- Keep maintenance restrictions for users.
- Ensure role checks are backend-enforced.

### Tasks
1. Centralize access policy constants.
2. Ensure non-admin blocked message is consistent across backend/frontend.
3. Verify admin impersonation audit trail records:
   - admin id
   - target user id
   - start time
   - end time
4. Block direct access to sensitive actions without role validation.

### Deliverables
- Access policy module.
- Impersonation audit log verification.

### Exit Gate
- Unauthorized attempts fail at backend even if frontend is bypassed.

### Rollback
- Revert policy module and restore previous auth checks.

---

## Phase 4: Move Critical Business Logic from Frontend to Backend (Day 2-3)
### Scope
Incrementally shift critical operations to server APIs (no mass rewrite).

### Migration Order (strict)
1. Fund transfer
2. PIN purchase/use/transfer
3. Withdrawal request + approval/reject
4. Matrix contribution/credit events
5. Admin credit/debit adjustments

### Tasks per operation
- Add backend API with input validation and idempotency.
- Update frontend to call API first.
- Keep temporary compatibility fallback only behind explicit flag.
- Add operation-level tests and parity checks.

### Deliverables
- Server-authoritative APIs for top critical actions.
- Frontend switched to backend-first execution.

### Exit Gate
- No critical money operation executes purely client-side.
- API logs + DB records are consistent.

### Rollback
- Per-operation feature flags to return to previous path temporarily.

---

## Phase 5: Matrix and Referral Correctness (Day 3)
### Scope
- Harden parent/child placement, level progression, and referral counts.

### Tasks
1. Validate matrix insert algorithm with deterministic tests.
2. Add constraints to prevent impossible placements.
3. Add repair utility for broken node links (safe mode first).
4. Recompute direct/team counts from source data and compare.

### Deliverables
- Matrix consistency checker and repair scripts.

### Exit Gate
- No orphan/dangling matrix links in latest report.

### Rollback
- Restore matrix snapshot and re-run prior stable logic.

---

## Phase 6: Admin Operations Reliability (Day 3-4)
### Scope
- Make admin actions traceable, reversible (where valid), and validated.

### Tasks
1. Add structured admin action log schema.
2. Add reason-required enforcement for admin money edits.
3. Add reversible action framework for selected operations.
4. Add pre-action simulation for high-impact admin operations.

### Deliverables
- Admin action ledger.
- Safer admin tooling behavior.

### Exit Gate
- Every admin financial action has actor, reason, before/after snapshot.

### Rollback
- Disable new admin paths and fall back to previous controls.

---

## Phase 7: Test, Rehearsal, and Reopen (Day 4)
### Scope
- End-to-end validation before lifting maintenance.

### Required Test Packs
1. Auth and role matrix tests.
2. Financial invariant tests.
3. Matrix placement and payout tests.
4. Sync and stale-write conflict tests.
5. Admin impersonation and audit tests.
6. Backup and restore drill.

### Reopen Criteria
All must pass:
1. Zero unexplained wallet/ledger mismatch.
2. No critical blocker in test pack.
3. Backup restored successfully in rehearsal.
4. Monitoring alerts configured.

### Reopen Steps
1. Remove maintenance lock for users.
2. Monitor high-risk endpoints for 24-48 hours.
3. Keep fast rollback ready.

---

## 6) Cross-Cutting Engineering Tasks
- Introduce feature flags for each migrated capability.
- Add request correlation IDs for traceability.
- Add structured logs for all money-impacting APIs.
- Add rate limits for auth and critical endpoints.
- Add explicit schema validation for API payloads.

## 7) Risk Register (High Priority)
1. Hidden duplicate credit paths in legacy frontend logic.
   - Mitigation: idempotency + backend-only execution for critical actions.
2. Data drift between state_store snapshots and relational tables.
   - Mitigation: parity report each phase.
3. Stale client overwrite of newer state.
   - Mitigation: strict version checks and conflict responses.
4. Admin action mistakes during recovery.
   - Mitigation: simulation mode + mandatory reason + action logs.

## 8) Change Management Workflow
For every implementation batch:
1. Create branch.
2. Implement small scoped change.
3. Run tests + audit script.
4. Commit with clear message.
5. Push and deploy.
6. Capture results in execution journal.
7. Ask for approval before next batch.

## 9) Recommended First Implementation Batch (After Plan Approval)
Batch-1 (safe and high impact):
1. Add centralized maintenance config constants in frontend/backend.
2. Add backend authoritative role guard helper.
3. Add audit script scaffold + first baseline report command.
4. Add feature flag scaffold for migration phases.

Expected outcome:
- Strong control plane for all next changes.
- Better visibility before touching financial core logic.

## 10) Definition of Done (Program Level)
System is considered fixed when:
1. Critical business actions are backend-authoritative.
2. Financial state is consistent and reproducible from ledger.
3. Matrix/referral structure is validated and stable.
4. Admin operations are fully auditable.
5. Backup/restore works reliably.
6. User-facing operations run normally after maintenance unlock.
