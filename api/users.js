const bcrypt = require('bcryptjs');
const { getPool, ensureSchema } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();

        if (url.includes('/staff')) {
            if (req.method === 'GET') {
                // Owner can see all; staff can see only their own branch
                const authUser = requireAuth(req, res, ['owner', 'staff']);
                if (!authUser) return;

                let query = `
                    SELECT u.user_id AS id, s.staff_id, u.name, u.username, u.email, u.role,
                           s.branch_id, s.specialization, b.name AS branch_name
                    FROM users u
                    JOIN staff s ON u.user_id = s.user_id
                    LEFT JOIN branches b ON s.branch_id = b.branch_id
                    WHERE u.role = 'staff'
                `;
                const params = [];
                if (authUser.role === 'staff' && authUser.branch_id) {
                    query += ' AND s.branch_id = ?';
                    params.push(authUser.branch_id);
                }
                query += ' ORDER BY u.name';
                const [rows] = await pool.query(query, params);
                return res.status(200).json({ success: true, staff: rows });
            }

            if (req.method === 'POST') {
                // Only owners can create staff
                const authUser = requireAuth(req, res, ['owner']);
                if (!authUser) return;

                const { name, username, email, password, branch_id, specialization } = req.body || {};
                if (!name || !username || !password || !branch_id) {
                    return res.status(400).json({ success: false, message: 'Name, username, password, and branch are required.' });
                }
                if (String(password).length < 8) {
                    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
                }

                const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
                let existingQuery = 'SELECT user_id FROM users WHERE username = ?';
                const existingParams = [String(username).trim()];
                if (normalizedEmail) {
                    existingQuery += ' OR email = ?';
                    existingParams.push(normalizedEmail);
                }
                const [existing] = await pool.query(existingQuery, existingParams);
                if (existing.length > 0) {
                    return res.status(409).json({ success: false, message: 'Username or email is already in use.' });
                }

                const connection = await pool.getConnection();
                try {
                    await connection.beginTransaction();
                    const hash = await bcrypt.hash(password, 10);
                    const [userResult] = await connection.query(
                        'INSERT INTO users (username, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
                        [String(username).trim(), normalizedEmail, hash, 'staff', String(name).trim()]
                    );
                    await connection.query(
                        'INSERT INTO staff (user_id, branch_id, specialization) VALUES (?, ?, ?)',
                        [userResult.insertId, branch_id, specialization || 'General Barber']
                    );
                    await connection.commit();
                    return res.status(201).json({ success: true, message: 'Staff created successfully.' });
                } catch (err) {
                    await connection.rollback();
                    throw err;
                } finally {
                    connection.release();
                }
            }

            return res.status(405).json({ success: false, message: 'Method not allowed' });
        }

        if (url.includes('/update')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            // Staff and clients can update their own profile; owner can update any
            const authUser = requireAuth(req, res, ['owner', 'staff', 'client']);
            if (!authUser) return;

            const { user_id, name, username, email, branch_id } = req.body || {};
            if (!user_id || !name || !username) {
                return res.status(400).json({ success: false, message: 'User ID, name, and username are required.' });
            }

            // Non-owners can only update their own profile
            if (authUser.role !== 'owner' && Number(authUser.id) !== Number(user_id)) {
                return res.status(403).json({ success: false, message: 'You can only update your own profile.' });
            }

            const params = [String(name).trim(), String(username).trim()];
            let query = 'UPDATE users SET name = ?, username = ?';
            if (email !== undefined) {
                query += ', email = ?';
                params.push(email ? String(email).trim().toLowerCase() : null);
            }
            query += ' WHERE user_id = ?';
            params.push(user_id);

            const [result] = await pool.query(query, params);
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }

            // Only owners can change branch assignments
            if (branch_id && authUser.role === 'owner') {
                await pool.query('UPDATE staff SET branch_id = ? WHERE user_id = ?', [branch_id, user_id]);
            }
            return res.status(200).json({ success: true, message: 'Profile updated successfully.' });
        }

        return res.status(404).json({ success: false, message: 'Route not found' });
    } catch (err) {
        console.error('Users API error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Username or email is already in use.' });
        }
        return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
};
