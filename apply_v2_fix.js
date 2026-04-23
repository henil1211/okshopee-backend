const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'backend', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Connection Limit
content = content.replace(/connectionLimit:\s*10,/, 'connectionLimit: 100,');

// 2. Registrations provisionedV2Users cache
const oldEnsure = /const ensureV2UserAndWallets = async \(legacyUser, legacyWallet\) => \{([\s\S]*?)const legacyUserId = String\(legacyUser\?\.id \|\| ''\)\.trim\(\) \|\| null;/;
const newEnsure = `const provisionedV2Users = new Set();
      const ensureV2UserAndWallets = async (legacyUser, legacyWallet) => {
        const userCode = normalizeV2UserCode(legacyUser?.userId);
        if (!isValidV2UserCode(userCode)) {
          throw createApiError(400, 'Invalid legacy user mapping for v2 provisioning', 'V2_PROVISION_USER_CODE_INVALID');
        }

        if (provisionedV2Users.has(userCode)) {
          return { userCode };
        }

        const legacyUserId = String(legacyUser?.id || '').trim() || null;`;

if (content.includes('const ensureV2UserAndWallets = async (legacyUser, legacyWallet) => {')) {
    content = content.replace(oldEnsure, newEnsure);
}

// 3. ProvisionedV2Users.add(userCode)
const oldEnd = /return \{ userId: Number\(v2User\.id\), userCode \};\s*\};/g;
const newEnd = `        provisionedV2Users.add(userCode);
        return { userId: Number(v2User.id), userCode };
      };`;
content = content.replace(oldEnd, newEnd);

// 4. Staggered background tasks
const oldBg = /\(async \(\) => \{([\s\S]*?)\}\)\(\);([\s\S]*?)finally \{/;
const newBg = `// Background tasks (Staggered to ensure main connection is released first)
      setTimeout(() => {
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

            // 2. Referral Settlement for Sponsor
            if (sponsorUser?.userId) {
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
              }).catch((e) => console.error(\`[Background] Referral settlement failed for \${createdUser.userId}:\`, e.message));
            }

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
            }).catch((e) => console.error(\`[Background] Help settlement failed for \${createdUser.userId}:\`, e.message));
          } catch (bgError) {
            console.error('[Background Execution Error]', bgError);
          }
        })();
      }, 100);$2finally {`;

if (content.includes('processV2ReferralCredit')) {
    content = content.replace(oldBg, newBg);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Backend optimizations applied successfully.');
