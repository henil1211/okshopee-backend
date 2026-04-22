const mysql = require('mysql2/promise');

const config = {
  host: 'auth-db657.hstgr.io',
  user: 'u480327317_pajjisindhu',
  password: 'Pajji@Sindhu24',
  database: 'u480327317_okshopee24'
};

const PIN_CODES = ["DA48FA1", "AE97921", "43B4535", "D7BFA2C", "F4EECB8", "4176CC2", "7A12A24"];

async function diagnostic() {
    const conn = await mysql.createConnection(config);
    try {
        console.log('--- DIAGNOSTIC START ---');
        
        // 1. Check Legacy State
        console.log('\n[1] LEGACY STATE STORE (mlm_pins):');
        const [stateRows] = await conn.execute('SELECT state_value FROM state_store WHERE state_key = "mlm_pins"');
        if (stateRows.length) {
            const pins = JSON.parse(stateRows[0].state_value);
            const targets = pins.filter(p => PIN_CODES.includes(String(p.pinCode).toUpperCase()));
            console.log('Target PINs in Legacy Array:');
            targets.forEach(p => console.log(`  - ${p.pinCode}: ${p.status}`));
            
            const statuses = [...new Set(pins.map(p => p.status))];
            console.log('\nAll unique statuses in Legacy store:', statuses);
        }

        // 2. Check V2 Ledger
        console.log('\n[2] V2 LEDGER (v2_pins table):');
        const [v2Rows] = await conn.execute(
            'SELECT pin_code, status FROM v2_pins WHERE pin_code IN (' + PIN_CODES.map(c => `"${c}"`).join(',') + ')'
        );
        console.log('Statuses in V2 Table:');
        v2Rows.forEach(r => console.log(`  - ${r.pin_code}: ${r.status}`));

        console.log('\n--- DIAGNOSTIC END ---');
    } catch (err) {
        console.error('Diagnostic failed:', err.message);
    } finally {
        await conn.end();
    }
}

diagnostic();
