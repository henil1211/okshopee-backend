import mysql from 'mysql2/promise';

const config = {
  host: 'auth-db657.hstgr.io',
  user: 'u480327317_pajjisindhu',
  password: 'Pajji@Sindhu24',
  database: 'u480327317_okshopee24'
};

async function updatePinStatus(pinCode, newStatus) {
    const conn = await mysql.createConnection(config);
    await conn.beginTransaction();
    console.log(`Starting ATOMIC update for PIN: ${pinCode} to status: ${newStatus}`);

    try {
        // 1. Lock and Load mlm_pins from state_store
        const [rows] = await conn.execute(
            'SELECT state_value FROM state_store WHERE state_key = "mlm_pins" FOR UPDATE'
        );
        
        if (!rows.length) throw new Error('mlm_pins state not found');
        
        const pins = JSON.parse(rows[0].state_value);
        const pinIndex = pins.findIndex(p => String(p.pinCode).toUpperCase() === pinCode.toUpperCase());
        
        if (pinIndex === -1) {
            throw new Error(`PIN ${pinCode} not found in state_store`);
        }

        // 2. Perform Atomic Modification in JSON
        const oldStatus = pins[pinIndex].status;
        pins[pinIndex].status = newStatus;
        console.log(`- Updated status in Legacy state: ${oldStatus} -> ${newStatus}`);

        // 3. Save specific key to state_store
        await conn.execute(
            'UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = "mlm_pins"',
            [JSON.stringify(pins)]
        );

        // 4. Align with v2_pins ledger
        // Safety: Valid status targets for V2 ledger are 'generated' (unused) or 'suspended'.
        // We never rollback 'used' or 'expired' pins.
        const v2StatusMap = {
            'unused': 'generated',
            'generated': 'generated',
            'suspended': 'suspended'
        };

        const targetV2Status = v2StatusMap[newStatus.toLowerCase()];
        if (targetV2Status) {
            const [v2Result] = await conn.execute(
                "UPDATE v2_pins SET status = ?, updated_at = NOW(3) WHERE pin_code = ? AND status NOT IN ('used', 'expired')",
                [targetV2Status, pinCode]
            );
            console.log(`- Updated V2 Ledger: ${v2Result.affectedRows} row(s) updated`);
        }

        await conn.commit();
        console.log('--- ATOMIC COMMIT SUCCESSFUL ---');

    } catch (e) {
        await conn.rollback();
        console.error('--- ATOMIC UPDATE FAILED (Rolled Back) ---');
        console.error(e.message);
    } finally {
        await conn.end();
    }
}

// CLI usage: node admin-pin-tool.js PINCODE STATUS
const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node scripts/admin-pin-tool.js <PIN_CODE> <STATUS>');
    console.log('Valid statuses: unused, suspended');
    process.exit(1);
}

updatePinStatus(args[0], args[1]);
