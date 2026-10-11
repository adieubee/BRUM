'use strict';
const bcrypt = require('bcryptjs');
const { getPool, ensureSchema } = require('./_lib/db');
const { createToken, persistSession, verifyRequestSession, requireAuth } = require('./_lib/auth');
const { audit } = require('./_lib/audit');

const MAX_FAILURES = 3;
const LOCK_MINUTES = 15;

module.exports = async function handler(req, res) {
    const pool = getPool();
    const route = (req.url || '').split('?')[0];
    res.setHeader('Cache-Control', 'no-store');
    try {
        await ensureSchema();
        await verifyRequestSession(req, res);

        if (route.endsWith('/me')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false });
            const user = requireAuth(req, res);
            if (!user) return;
            return res.status(200).json({ success: true, user });
        }
        if (route.endsWith('/logout')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false });
            const user = requireAuth(req, res);
            if (!user) return;
            await pool.query('UPDATE api_sessions SET revoked_at = NOW() WHERE session_id = ?', [user.sid]);
            await audit(pool, req, 'session.logout', 'user', user.id);
            return res.status(200).json({ success: true });
        }
        if (route.endsWith('/login')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false });
            const identifier = String(req.body?.username || '').trim().toLowerCase().slice(0, 255);
            const password = String(req.body?.password || '');
            if (!identifier || !password || password.length > 1024) return res.status(400).json({ success: false, message: 'Username/email and password are required.' });
            const [locks] = await pool.query('SELECT failed_count, locked_until FROM login_attempts WHERE identifier = ? LIMIT 1', [identifier]);
            const lock = locks[0];
            if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) {
                return res.status(429).json({ success: false, message: 'Too many unsuccessful attempts. Please try again after 15 minutes.', retry_after_seconds: Math.ceil((new Date(lock.locked_until).getTime() - Date.now()) / 1000) });
            }
            const [users] = await pool.query(
                'SELECT user_id, username, email, password_hash, role, name FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1',
                [identifier, identifier]
            );
            const user = users[0];
            // Use the same bcrypt workload when an account does not exist.
            const fallbackHash = '$2a$10$KGgym/DaEJAwTDbYs.Fa/eyIzyIVIjGgP05wHaZfskTMI7mc69AOi';
            const valid = await bcrypt.compare(password, user?.password_hash || fallbackHash);
            if (!user || !valid) {
                await pool.query(`INSERT INTO login_attempts(identifier,failed_count,locked_until,last_failed)
                    VALUES (?,1,NULL,NOW())
                    ON DUPLICATE KEY UPDATE
                    locked_until = IF(IF(last_failed < DATE_SUB(NOW(), INTERVAL 15 MINUTE),1,failed_count+1) >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL),
                    failed_count = IF(last_failed < DATE_SUB(NOW(), INTERVAL 15 MINUTE),1,failed_count+1),
                    last_failed = NOW()`, [identifier, MAX_FAILURES, LOCK_MINUTES]);
                await audit(pool, req, 'auth.login_failed', 'account', null);
                return res.status(401).json({ success: false, message: 'Invalid username/email or password. After 3 failures, login is locked for 15 minutes.' });
            }
            if (user.role === 'staff') {
                const [staffRows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ? AND is_active = 1 LIMIT 1', [user.user_id]);
                if (!staffRows.length) return res.status(403).json({ success: false, message: 'Staff account has no assigned branch.' });
                user.branch_id = staffRows[0].branch_id;
            }
            await pool.query('DELETE FROM login_attempts WHERE identifier = ?', [identifier]);
            const userObj = { id: user.user_id, username: user.username, email: user.email, name: user.name, role: user.role, branch_id: user.branch_id ?? null };
            const token = createToken(userObj);
            await persistSession(pool, token, userObj, req);
            await audit(pool, req, 'auth.login', 'user', user.user_id, null, user.user_id);
            return res.status(200).json({ success: true, token, role: user.role, user: userObj, idle_timeout_seconds: 1200 });
        }
        if (route.endsWith('/register')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false });
            const name = String(req.body?.name || '').trim().slice(0, 100);
            const username = String(req.body?.username || '').trim().slice(0, 50);
            const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);
            const password = String(req.body?.password || '');
            if (!name || !username || !email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 1024) {
                return res.status(400).json({ success: false, message: 'Provide a name, username, valid email and password of at least 8 characters.' });
            }
            const hash = await bcrypt.hash(password, 12);
            const connection = await pool.getConnection();
            let userId;
            try {
                await connection.beginTransaction();
                const [result] = await connection.query('INSERT INTO users(username,email,password_hash,role,name) VALUES(?,?,?,?,?)', [username, email, hash, 'client', name]);
                userId = result.insertId;
                await connection.query('INSERT INTO clients(user_id) VALUES(?)', [userId]);
                await connection.commit();
            } catch (error) { await connection.rollback(); throw error; }
            finally { connection.release(); }
            const userObj = { id: userId, username, email, name, role: 'client', branch_id: null };
            const token = createToken(userObj);
            await persistSession(pool, token, userObj, req);
            await audit(pool, req, 'auth.register', 'user', userId, null, userId);
            return res.status(201).json({ success: true, token, user: userObj });
        }
        return res.status(404).json({ success: false, message: 'Auth route not found.' });
    } catch (err) {
        console.error('Auth error:', err);
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Username or email already taken.' });
        return res.status(500).json({ success: false, message: 'Authentication service unavailable.' });
    }
};
