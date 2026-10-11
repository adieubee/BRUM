'use strict';
const { requestIpHash } = require('./auth');

async function audit(pool, req, event, entityType = null, entityId = null, details = null, actorId) {
    const userId = actorId === undefined ? req._authUser?.id ?? null : actorId;
    const json = details == null ? null : JSON.stringify(details);
    await pool.query(
        `INSERT INTO audit_log(actor_user_id,event,entity_type,entity_id,details,ip_hash)
         VALUES (?,?,?,?,?,?)`,
        [userId, event, entityType, entityId == null ? null : String(entityId), json, requestIpHash(req)]
    );
}
module.exports = { audit };
