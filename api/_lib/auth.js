/**
 * _lib/auth.js
 * Lightweight signed-token auth for Vercel serverless (no JWT dependency).
 * Token format: base64url(JSON payload) + "." + HMAC-SHA256 hex signature
 * SECRET is read from process.env.TOKEN_SECRET (fall back to a hard-coded dev value).
 */
const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'brums-dev-secret-change-in-prod';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function b64url(str) {
    return Buffer.from(str).toString('base64url');
}

function sign(payload) {
    const data = b64url(JSON.stringify(payload));
    const sig = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
    return `${data}.${sig}`;
}

function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    try {
        // The signature must be recomputed from the token payload using the same
        // secret used by createToken(). An undefined expected signature rejects
        // every token and makes all protected endpoints return 401.
        const expected = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
        if (!/^[a-f0-9]{64}$/i.test(sig)) return null;
        const sigBuf = Buffer.from(sig, 'hex');
        const expBuf = Buffer.from(expected, 'hex');
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) return null; // expired
        return payload;
    } catch {
        return null;
    }
}

/**
 * Create a signed login token.
 * @param {{ id, username, role, branch_id }} user
 */
function createToken(user) {
    const payload = {
        id: user.id,
        username: user.username,
        role: user.role,
        branch_id: user.branch_id ?? null,
        exp: Date.now() + TOKEN_TTL_MS
    };
    return sign(payload);
}

/**
 * Extract and verify the Bearer token from a request.
 * Returns the payload or null.
 */
function getTokenPayload(req) {
    const headers = req.headers || {};
    const auth = headers.authorization || headers.Authorization;
    if (typeof auth !== 'string') return null;
    const match = auth.trim().match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    return verify(match[1].trim());
}

/**
 * Middleware helper — call at the top of any protected handler.
 * @param {object} req
 * @param {object} res
 * @param {string[]} allowedRoles  e.g. ['owner', 'staff']  — empty means any authenticated user
 * @returns {object|null} payload on success, null if already responded with 401/403
 */
function requireAuth(req, res, allowedRoles = []) {
    const payload = getTokenPayload(req);
    console.log(payload)
    if (!payload) {
        res.status(401).json({ success: false, message: 'Authentication required.' });
        return null;
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
        res.status(403).json({ success: false, message: 'Insufficient permissions.' });
        return null;
    }
    return payload;
}

module.exports = { createToken, getTokenPayload, requireAuth };
