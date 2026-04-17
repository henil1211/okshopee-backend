import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLegacyDirectCountMap,
  claimPendingContributionForProcessing,
  computeV2HelpSettlementDecision,
  extractIncrementalDirectRequirementsFromLegacySettings,
  getV2CumulativeDirectRequired,
  isV2UserQualifiedForLevel
} from '../help-cascade-rules.js';

test('extractIncrementalDirectRequirementsFromLegacySettings reads table directRequired increments', () => {
  const requirements = extractIncrementalDirectRequirementsFromLegacySettings({
    helpDistributionTable: [
      { level: 1, directRequired: 0 },
      { level: 2, directRequired: 2 },
      { level: 3, directRequired: 3 },
      { level: 4, directRequired: 4 }
    ]
  }, 4);

  assert.deepEqual(requirements, [0, 2, 3, 4]);
  assert.equal(getV2CumulativeDirectRequired(4, requirements), 9);
});

test('buildLegacyDirectCountMap keeps max of stored directCount and computed active directs', () => {
  const map = buildLegacyDirectCountMap([
    { userId: '1000001', directCount: 1, accountStatus: 'active', isActive: true },
    { userId: '2000002', sponsorId: '1000001', accountStatus: 'active', isActive: true },
    { userId: '2000003', sponsorId: '1000001', accountStatus: 'temp_blocked', isActive: false },
    { userId: '2000004', sponsorId: '1000001', accountStatus: 'inactive', isActive: false }
  ]);

  assert.equal(map.get('1000001'), 2);
});

test('isV2UserQualifiedForLevel applies cumulative direct requirements', () => {
  const directCountByUserCode = new Map([
    ['1000001', 5],
    ['2000002', 1]
  ]);
  const incrementalRequirements = [0, 2, 3, 4];

  assert.equal(
    isV2UserQualifiedForLevel({
      userCode: '1000001',
      levelNo: 3,
      directCountByUserCode,
      incrementalRequirements
    }),
    true
  );

  assert.equal(
    isV2UserQualifiedForLevel({
      userCode: '2000002',
      levelNo: 3,
      directCountByUserCode,
      incrementalRequirements
    }),
    false
  );
});

test('computeV2HelpSettlementDecision enforces first-two, fifth-diversion, and qualification release', () => {
  const firstTwo = computeV2HelpSettlementDecision({
    receiveCountBefore: 1,
    safetyDeductedCents: 0,
    isQualifiedForLevel: true,
    amountCents: 500,
    lockedQualificationCents: 0
  });
  assert.equal(firstTwo.mode, 'locked_for_give');
  assert.equal(firstTwo.lockFirstTwoCents, 500);

  const fifthDiversion = computeV2HelpSettlementDecision({
    receiveCountBefore: 4,
    safetyDeductedCents: 0,
    isQualifiedForLevel: true,
    amountCents: 500,
    lockedQualificationCents: 0
  });
  assert.equal(fifthDiversion.mode, 'safety_pool_diversion');
  assert.equal(fifthDiversion.divertedSafetyCents, 500);

  const unqualified = computeV2HelpSettlementDecision({
    receiveCountBefore: 2,
    safetyDeductedCents: 0,
    isQualifiedForLevel: false,
    amountCents: 500,
    lockedQualificationCents: 0
  });
  assert.equal(unqualified.mode, 'locked_for_qualification');
  assert.equal(unqualified.lockQualificationCents, 500);

  const qualifiedWithRelease = computeV2HelpSettlementDecision({
    receiveCountBefore: 6,
    safetyDeductedCents: 500,
    isQualifiedForLevel: true,
    amountCents: 500,
    lockedQualificationCents: 1000
  });
  assert.equal(qualifiedWithRelease.mode, 'income_credit_with_release');
  assert.equal(qualifiedWithRelease.incomeCreditCents, 1500);
  assert.equal(qualifiedWithRelease.qualificationReleaseCents, 1000);
});

test('claimPendingContributionForProcessing allows only one winner under concurrency', async () => {
  const rows = new Map([[77, { status: 'pending', reason: null }]]);

  const mockConnection = {
    async execute(sql, params) {
      if (!String(sql).includes('UPDATE v2_help_pending_contributions')) {
        throw new Error('Unexpected SQL in test');
      }

      const reason = String(params[0] || '');
      const id = Number(params[1] || 0);
      const row = rows.get(id);
      if (!row) return [{ affectedRows: 0 }];

      await Promise.resolve();

      if (row.status === 'pending' && row.reason === null) {
        row.reason = reason;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }
  };

  const [a, b] = await Promise.all([
    claimPendingContributionForProcessing(mockConnection, {
      pendingContributionId: 77,
      claimToken: 'worker-a'
    }),
    claimPendingContributionForProcessing(mockConnection, {
      pendingContributionId: 77,
      claimToken: 'worker-b'
    })
  ]);

  assert.equal(Number(a) + Number(b), 1);
  assert.match(String(rows.get(77)?.reason || ''), /^processing:/);
});
