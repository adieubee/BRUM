const bcrypt = require('bcryptjs');
const { getPool, ensureEmailColumn } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    if (url.includes('/login')) {
        if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username or email and password are required.' });
        }

        try {
            await ensureEmailColumn();
            const [users] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);

            if (users.length === 0) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }

            const user = users[0];
            const match = await bcrypt.compare(password, user.password_hash);

            if (!match) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }

            let branch_id = null;
            if (user.role === 'staff') {
                const [staffRows] = await pool.query('SELECT branch_id FROM staff WHERE user_id = ?', [user.user_id]);
                if (staffRows.length > 0) branch_id = staffRows[0].branch_id;
            }

            return res.status(200).json({
                success: true,
                role: user.role,
                user: {
                    id: user.user_id,
                    username: user.username,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    branch_id
                }
            });
        } catch (err) {
            console.error('Login error:', err);
            return res.status(500).json({ success: false, message: 'Server error.' });
        }
    }
    else if (url.includes('/register')) {
        if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

        const { name, username, email, password } = req.body;
        if (!name || !username || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, username, email, and password are required.' });
        }

        try {
            await ensureEmailColumn();
            const [existing] = await pool.query('SELECT user_id FROM users WHERE username = ? OR email = ?', [username, email]);
            if (existing.length > 0) {
                return res.status(409).json({ success: false, message: 'Username or email already taken.' });
            }

            const hash = await bcrypt.hash(password, 10);
            const [result] = await pool.query(
                'INSERT INTO users (username, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
                [username, email, hash, 'client', name]
            );

            return res.status(201).json({
                success: true,
                user: {
                    id: result.insertId,
                    username,
                    email,
                    name,
                    role: 'client'
                }
            });
        } catch (err) {
            console.error('Register error:', err);
            return res.status(500).json({ success: false, message: 'Server error.' });
        }
    }
    else {
        return res.status(404).json({ success: false, message: 'Auth route not found' });
    }
};