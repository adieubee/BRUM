const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const pool = getPool();
        const [rows] = await pool.query('SELECT * FROM services ORDER BY service_id');
        return res.status(200).json({ success: true, services: rows });
    } catch (err) {
        console.error('Services fetch error:', err);
        return res.status(500).json({ success: false, message: 'Server error.' });
    }
};