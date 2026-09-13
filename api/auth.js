const bcrypt = require('bcryptjs');
const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    if (url.includes('/login')) {
        if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required.' });
        }

        try {
            const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

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
                    name: user.name,
                    role: user.role,
                    phone: user.phone,
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

        const { name, username, password, phone } = req.body;
        if (!name || !username || !password || !phone) {
            return res.status(400).json({ success: false, message: 'Name, username, password, and phone number are required.' });
        }

        try {
            const [existing] = await pool.query('SELECT user_id FROM users WHERE username = ?', [username]);
            if (existing.length > 0) {
                return res.status(409).json({ success: false, message: 'Username already taken.' });
            }

            const hash = await bcrypt.hash(password, 10);
            const [result] = await pool.query(
                'INSERT INTO users (username, password_hash, role, name, phone) VALUES (?, ?, ?, ?, ?)',
                [username, hash, 'client', name, phone]
            );

            return res.status(201).json({
                success: true,
                user: {
                    id: result.insertId,
                    username,
                    name,
                    role: 'client',
                    phone
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