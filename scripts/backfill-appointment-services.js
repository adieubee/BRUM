/** Safe, repeatable post-upgrade migration for legacy CSV appointment service_ids. */
const { getPool, ensureSchema } = require('../api/_lib/db');

async function backfill() {
    await ensureSchema();
    const db = getPool();
    const [validServices] = await db.query('SELECT service_id FROM services');
    const allowed = new Set(validServices.map(r => Number(r.service_id)));
    const [appointments] = await db.query('SELECT appointment_id, service_id, service_ids FROM appointments');
    let updated = 0, skipped = 0;
    for (const a of appointments) {
        const raw = String(a.service_ids || a.service_id || '').split(',').map(x => x.trim());
        const counts = new Map();
        for (const value of raw) {
            if (!/^\d+$/.test(value) || !allowed.has(Number(value))) { skipped++; continue; }
            const id = Number(value);
            counts.set(id, (counts.get(id) || 0) + 1);
        }
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            for (const [id, quantity] of counts) {
                await connection.query(`INSERT INTO appointment_services (appointment_id, service_id, quantity)
                    VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
                    [a.appointment_id, id, quantity]);
                updated++;
            }
            await connection.commit();
        } catch (e) { await connection.rollback(); throw e; }
        finally { connection.release(); }
    }
    console.log(`Appointment/service links processed: ${updated}; invalid legacy IDs skipped: ${skipped}.`);
    await db.end();
}
backfill().catch(e => { console.error('Migration failed:', e.message); process.exitCode = 1; });
