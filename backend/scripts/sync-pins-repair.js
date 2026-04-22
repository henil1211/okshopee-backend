import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const config = {
  host: process.env.MYSQL_HOST || 'auth-db657.hstgr.io',
  user: process.env.MYSQL_USER || 'u480327317_pajjisindhu',
  password: process.env.MYSQL_PASSWORD || 'Pajji@Sindhu24',
  database: process.env.MYSQL_DATABASE || 'u480327317_okshopee24'
};

async function syncPinsRepair() {
    console.log('Starting PIN Synchronization Repair...');
    const conn = await mysql.createConnection(config);
    
    try {
        // 1. Fetch V2 State
        const [v2Pins] = await conn.execute('SELECT pin_code, status, created_at, used_at, used_by_user_id FROM v2_pins');
        
        // 2. Fetch Legacy State (Locked for Update)
        await conn.beginTransaction();
        const [stateRows] = await conn.execute('SELECT state_key, state_value FROM state_store WHERE state_key IN ("mlm_pins", "mlm_users") FOR UPDATE');
        
        const stateByKey = new Map(stateRows.map(r => [r.state_key, r.state_value]));
        const legacyPinsOrig = JSON.parse(stateByKey.get('mlm_pins') || '[]');
        const legacyUsers = JSON.parse(stateByKey.get('mlm_users') || '[]');
        
        let legacyPins = [...legacyPinsOrig];
        
        console.log(`Initial Counts -> V2 Pins: ${v2Pins.length}, Legacy Pins: ${legacyPins.length}, Legacy Users: ${legacyUsers.length}`);

        let legacyUpdated = false;
        let v2UpdatedCount = 0;

        // Path A: V2 -> Legacy (Fixes "Invalid PIN" for unused PINs)
        for (const vPin of v2Pins) {
            const lIndex = legacyPins.findIndex(l => l.pinCode === vPin.pin_code);
            
            if (lIndex === -1) {
                console.log(`[Adding to Legacy] ${vPin.pin_code} (status: ${vPin.status})`);
                legacyPins.push({
                    id: `pin_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    pinCode: vPin.pin_code,
                    status: vPin.status === 'generated' ? 'unused' : vPin.status,
                    amount: 11,
                    type: 'activation',
                    ownerId: 'user_system',
                    usedById: vPin.used_by_user_id ? String(vPin.used_by_user_id) : null,
                    usedAt: vPin.used_at ? vPin.used_at.toISOString() : null,
                    createdAt: vPin.created_at.toISOString()
                });
                legacyUpdated = true;
            } else {
                // Path B: Legacy -> V2 (Fixes "Shows as Unused in UI" for used PINs)
                const lPin = legacyPins[lIndex];
                const lStatus = String(lPin.status).toLowerCase();
                
                if (lStatus === 'used' && vPin.status === 'generated') {
                    console.log(`[Updating V2 Status to USED] ${vPin.pin_code}`);
                    
                    let v2UserId = null;
                    if (lPin.usedById) {
                        // The usedById in Legacy is often an internal string like user_... 
                        // We need to find the user in Legacy first, get their USER CODE (e.g. 6052865), 
                        // then find that user in V2.
                        const usedByUser = legacyUsers.find(u => u.id === lPin.usedById || u.userId === lPin.usedById);
                        if (usedByUser) {
                            const [v2Users] = await conn.execute("SELECT id FROM v2_users WHERE user_code = ?", [usedByUser.userId]);
                            if (v2Users.length > 0) {
                                v2UserId = v2Users[0].id;
                            }
                        }
                    }

                    await conn.execute(
                        "UPDATE v2_pins SET status = 'used', used_at = ?, used_by_user_id = ? WHERE pin_code = ?",
                        [lPin.usedAt || new Date().toISOString(), v2UserId, vPin.pin_code]
                    );
                    v2UpdatedCount++;
                }
            }
        }

        if (legacyUpdated) {
            console.log(`Updating state_store with ${legacyPins.length} records...`);
            await conn.execute(
                "UPDATE state_store SET state_value = ?, updated_at = NOW() WHERE state_key = 'mlm_pins'",
                [JSON.stringify(legacyPins)]
            );
        }

        await conn.commit();
        console.log('--- REPAIR COMPLETE ---');
        console.log(`Legacy records added/synced: ${legacyUpdated}`);
        console.log(`V2 records updated to USED: ${v2UpdatedCount}`);

    } catch (e) {
        await conn.rollback();
        console.error('Repair failed:', e);
    } finally {
        await conn.end();
    }
}

syncPinsRepair();
