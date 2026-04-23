const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'server.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

const newCode = `      const upsertStateKey = async (key, value) => {
        await connection.execute(
          \`INSERT INTO state_store (state_key, state_value, updated_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = VALUES(updated_at)\`,
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
        \`UPDATE v2_pins 
         SET status = 'used', 
             used_by_user_id = (SELECT id FROM v2_users WHERE user_code = ?),
             used_at = ?
         WHERE pin_code = ?\`,
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
          const referralSourceRef = \`reg_pin_\${createdUser.userId}_\${sponsorUser.userId}\`;
          const referralIdempotencyKey = \`reg_ref_\${createdUser.userId}_\${sponsorUser.userId}_\${pinCode}\`.slice(0, 128);
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
            description: \`Referral income from \${createdUser.fullName} (\${createdUser.userId})\`
          }).catch(e => console.error(\`[Background] Referral settlement failed for \${createdUser.userId}:\`, e.message));

          // 3. Help Settlement
          const helpSourceRef = \`reg_help_\${createdUser.userId}_\${createdUser.userId}\`;
          const helpIdempotencyKey = \`reg_help_\${createdUser.userId}_\${pinCode}\`.slice(0, 128);
          await processV2HelpEvent({
            idempotencyKey: helpIdempotencyKey,
            actorUserCode: createdUser.userId,
            sourceUserCode: createdUser.userId,
            newMemberUserCode: createdUser.userId,
            sourceRef: helpSourceRef,
            eventType: 'activation_join',
            allowInactiveActor: false,
            description: \`Activation help event for \${createdUser.fullName} (\${createdUser.userId})\`
          }).catch(e => console.error(\`[Background] Help settlement failed for \${createdUser.userId}:\`, e.message));

        } catch (sideEffectError) {
          console.error(\`[Background] Side effects failed for user \${createdUser.userId}:\`, sideEffectError.message);
        }
      })();`;

// Replacement range (1-indexed lines 7867 to 7951 -> 0-indexed indices 7866 to 7950)
lines.splice(7866, 7951 - 7867 + 1, newCode);

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log('Repair complete via Node.js CJS');
