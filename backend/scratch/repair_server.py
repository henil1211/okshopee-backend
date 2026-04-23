import sys

file_path = r'e:\Again Updated\live-project\backend\server.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Correct registration success block
new_code = """      const upsertStateKey = async (key, value) => {
        await connection.execute(
          `INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)`,
          [key, JSON.stringify(value), nowDb]
        );
      };

      await upsertStateKey('mlm_users', users);
      await upsertStateKey('mlm_wallets', wallets);
      await upsertStateKey('mlm_matrix', matrix);
      await upsertStateKey('mlm_pins', pins);
      await upsertStateKey('mlm_transactions', transactions);
      await upsertStateKey('mlm_notifications', notifications);
      await upsertStateKey('mlm_safety_pool', safetyPool);
      
      // Synchronize PIN usage to V2 database
      await connection.execute(
        `UPDATE v2_pins 
         SET status = 'used', 
             used_by_user_id = (SELECT id FROM v2_users WHERE user_code = ?),
             used_at = ?
         WHERE pin_code = ?`,
        [createdUser.userId, nowDb, pinCode]
      );

      await connection.commit();
      transactionOpen = false;
      invalidateStateSnapshotCache();

      // Send Response Immediately
      sendJson(res, 200, {
        ok: true,
        idempotentReplay: false,
        userId: createdUser.userId,
        sponsorUserId: sponsorUser.userId,
        pinCode,
        sideEffects: 'backgrounded'
      });

      // Side Effects (Backgrounded to prevent timeout)
      (async () => {
        try {
          // 1. Welcome Email
          await sendRegistrationWelcomeEmailBestEffort({
            to: createdUser.email,
            fullName: createdUser.fullName,
            userId: createdUser.userId,
            email: createdUser.email,
            phone: createdUser.phone,
            loginPassword: createdUser.password,
            transactionPassword: createdUser.transactionPassword
          });

          // 2. Referral Settlement
          const referralSourceRef = `reg_pin_${createdUser.userId}_${sponsorUser.userId}`;
          const referralIdempotencyKey = `reg_ref_${createdUser.userId}_${sponsorUser.userId}_${pinCode}`.slice(0, 128);
          await processV2ReferralCredit({
            idempotencyKey: referralIdempotencyKey,
            actorUserCode: createdUser.userId,
            sourceUserCode: createdUser.userId,
            beneficiaryUserCode: sponsorUser.userId,
            allowInactiveActor: false,
            sourceRef: referralSourceRef,
            eventType: 'direct_referral',
            levelNo: 1,
            amountCents: 500,
            description: `Referral income from ${createdUser.fullName} (${createdUser.userId})`
          }).catch(e => console.error(`[Background] Referral settlement failed for ${createdUser.userId}:`, e.message));

          // 3. Help Settlement
          const helpSourceRef = `reg_help_${createdUser.userId}_${createdUser.userId}`;
          const helpIdempotencyKey = `reg_help_${createdUser.userId}_${pinCode}`.slice(0, 128);
          await processV2HelpEvent({
            idempotencyKey: helpIdempotencyKey,
            actorUserCode: createdUser.userId,
            sourceUserCode: createdUser.userId,
            newMemberUserCode: createdUser.userId,
            sourceRef: helpSourceRef,
            eventType: 'activation_join',
            allowInactiveActor: false,
            description: `Activation help event for ${createdUser.fullName} (${createdUser.userId})`
          }).catch(e => console.error(`[Background] Help settlement failed for ${createdUser.userId}:`, e.message));

        } catch (sideEffectError) {
          console.error(`[Background] Side effects failed for user ${createdUser.userId}:`, sideEffectError.message);
        }
      })();
"""

# Replace lines 7867 to 7951 (0-indexed: 7866 to 7951)
# Note: lines[7866] is line 7867. lines[7951] is line 7952.
# So we replace lines[7866:7951] with the new code.
lines[7866:7951] = [new_code + "\\n"] # Double backslash to avoid escape issues if needed, but normally just \\n

# Actually, let's just use string join to be safe.
# Re-reading lines indices:
# 7860: beneficiaryLegacyUser, (index 7859)
# 7866: const nowDb = toMySQLDatetime(nowIso); (index 7865)
# 7867: const upsertStateKey = async (key, value) => { (index 7866) - START REPLACEMENT
# 7951: helpEventResult (index 7950) - END REPLACEMENT
# 7952: } catch (error) { (index 7951) - KEEP

lines[7866:7951] = [new_code]

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Repair complete.")
