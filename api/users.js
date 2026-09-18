const bcrypt = require('bcryptjs');
const { getPool, ensureSchema } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();

        if (url.includes('/staff')) {
            if (req.method === 'GET') {
                const [rows] = await pool.query(`
                    SELECT u.user_id AS id, s.staff_id, u.name, u.username, u.email, u.role,
                           s.branch_id, s.specialization, b.name AS branch_name
                    FROM users u
                    JOIN staff s ON u.user_id = s.user_id
                    LEFT JOIN branches b ON s.branch_id = b.branch_id
                    WHERE u.role = 'staff'
                    ORDER BY u.name
                `);
                return res.status(200).json({ success: true, staff: rows });
            }

            if (req.method === 'POST') {
                const { name, username, email, password, branch_id, specialization } = req.body || {};
                if (!name || !username || !password || !branch_id) {
                    return res.status(400).json({ success: false, message: 'Name, username, password, and branch are required.' });
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
                        [userResult.insertId, branch_id, specialization || 'General Dermatechnician']
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

            const { user_id, name, username, email, branch_id } = req.body || {};
            if (!user_id || !name || !username) {
                return res.status(400).json({ success: false, message: 'User ID, name, and username are required.' });
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

            if (branch_id) {
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
