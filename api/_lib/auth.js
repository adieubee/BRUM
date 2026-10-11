'use strict';
const crypto = require('crypto');
const { getPool } = require('./db');

const PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const SECRET = process.env.TOKEN_SECRET || (PROD ? '' : 'brums-local-development-only-secret');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const IDLE_TTL_MS = 20 * 60 * 1000;

function sign(payload) {
    if (!SECRET || (PROD && SECRET.length < 32)) throw new Error('Set TOKEN_SECRET to a random secret of at least 32 characters.');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    return `${body}.${signature}`;
}
function verify(token) {
    if (!SECRET || typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(parts[0]).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(parts[1], 'hex'))) return null;
    try {
        const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        if (!Number.isSafeInteger(p.id) || !Number.isSafeInteger(p.exp) || p.exp <= Date.now() || !/^[a-f0-9]{32}$/.test(p.sid || '')) return null;
        return p;
    } catch { return null; }
}
function bearer(req) {
    const header = req.headers?.authorization || req.headers?.Authorization || '';
    const match = String(header).match(/^Bearer\s+([^\s]+)$/i);
    return match ? match[1] : null;
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function createToken(user) {
    return sign({ id: Number(user.id), role: user.role, sid: crypto.randomBytes(16).toString('hex'), exp: Date.now() + TOKEN_TTL_MS });
}
async function persistSession(pool, token, user, req) {
    const p = verify(token);
    if (!p) throw new Error('Unable to create session');
    await pool.query(
        `INSERT INTO api_sessions (session_id, user_id, token_hash, role_at_login, expires_at, last_seen_at, ip_hash)
         VALUES (?, ?, ?, ?, FROM_UNIXTIME(?), NOW(), ?)`,
        [p.sid, user.id, hashToken(token), user.role, Math.floor(p.exp / 1000), requestIpHash(req)]
    );
}
function requestIpHash(req) {
    // Never persist raw visitor IP addresses.
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    return crypto.createHash('sha256').update(`${process.env.AUDIT_SALT || SECRET}:${ip}`).digest('hex');
}
async function verifyRequestSession(req, res) {
    if (req._sessionChecked) return req._authUser;
    req._sessionChecked = true;
    const raw = bearer(req);
    if (!raw) { req._authUser = null; return null; }
    const payload = verify(raw);
    if (!payload) { req._authUser = null; return null; }
    const [rows] = await getPool().query(
        `SELECT u.user_id, u.username, u.role, u.name, s.branch_id,
                a.session_id, a.role_at_login, a.revoked_at, a.last_seen_at,
                a.expires_at
         FROM api_sessions a JOIN users u ON u.user_id = a.user_id
         LEFT JOIN staff s ON s.user_id = u.user_id AND s.is_active=1
         WHERE a.session_id = ? AND a.user_id = ? AND a.token_hash = ? LIMIT 1`,
        [payload.sid, payload.id, hashToken(raw)]
    );
    const row = rows[0];
    const valid = row && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()
        && new Date(row.last_seen_at).getTime() > Date.now() - IDLE_TTL_MS
        && row.role === payload.role && row.role_at_login === row.role
        && (row.role !== 'staff' || row.branch_id != null);
    if (!valid) { req._authUser = null; return null; }
    req._authUser = {
        id: row.user_id, username: row.username, name: row.name,
        role: row.role, branch_id: row.branch_id ?? null, sid: payload.sid
    };
    await getPool().query('UPDATE api_sessions SET last_seen_at = NOW() WHERE session_id = ?', [payload.sid]);
    return req._authUser;
}
function getTokenPayload(req) {
    // Never trust a token without its database session and current role being checked.
    return req._sessionChecked ? req._authUser || null : null;
}
function requireAuth(req, res, allowedRoles = []) {
    const payload = getTokenPayload(req);
    if (!payload) { res.status(401).json({ success: false, message: 'Please sign in again. Your session may have expired.' }); return null; }
    if (allowedRoles.length && !allowedRoles.includes(payload.role)) {
        res.status(403).json({ success: false, message: 'Insufficient permissions.' }); return null;
    }
    return payload;
}
module.exports = { createToken, persistSession, verifyRequestSession, getTokenPayload, requireAuth, requestIpHash, IDLE_TTL_MS };
