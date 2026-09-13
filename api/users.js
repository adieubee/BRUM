const bcrypt = require('bcryptjs');
const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        if (url.includes('/staff')) {
            if (req.method === 'GET') {
                const [rows] = await pool.query(`
                    SELECT u.user_id as id, s.staff_id, u.name, u.username, u.role, s.branch_id, s.specialization
                    FROM users u
                             LEFT JOIN staff s ON u.user_id = s.user_id
                    WHERE u.role = 'staff'
                `);
                return res.status(200).json({ success: true, staff: rows });
            }
            else if (req.method === 'POST') {
                const { name, username, password, branch_id, specialization } = req.body;
                if (!name || !username || !password || !branch_id) {
                    return res.status(400).json({ success: false, message: 'All fields are required.' });
                }
                const [existing] = await pool.query('SELECT user_id FROM users WHERE username = ?', [username]);
                if (existing.length > 0) return res.status(409).json({ success: false, message: 'Username already taken.' });

                const hash = await bcrypt.hash(password, 10);
                const [userResult] = await pool.query(
                    'INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, ?, ?)',
                    [username, hash, 'staff', name]
                );
                const userId = userResult.insertId;
                await pool.query('INSERT INTO staff (user_id, branch_id, specialization) VALUES (?, ?, ?)', [userId, branch_id, specialization || 'General Barber']);

                return res.status(201).json({ success: true, message: 'Staff created successfully.' });
            }
        }
        else if (url.includes('/update')) {
            if (req.method !== 'PUT') return res.status(405).json({ message: 'Method not allowed' });
            const { user_id, name, username, phone, branch_id } = req.body;
            if (!user_id || !name || !username) {
                return res.status(400).json({ success: false, message: 'User ID, name, and username are required.' });
            }

            await pool.query('UPDATE users SET name = ?, username = ?, phone = ? WHERE user_id = ?', [name, username, phone || null, user_id]);
            if (branch_id) {
                await pool.query('UPDATE staff SET branch_id = ? WHERE user_id = ?', [branch_id, user_id]);
            }
            return res.status(200).json({ success: true, message: 'Profile updated successfully.' });
        }
        return res.status(404).json({ success: false, message: 'Route not found' });
    } catch (err) {
        console.error('Users API error:', err);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
};