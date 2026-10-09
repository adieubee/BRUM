const { getPool, ensureSchema } = require('./_lib/db');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
    try {
        await ensureSchema();
        const [rows] = await getPool().query('SELECT * FROM branches ORDER BY branch_id');
        return res.status(200).json({ success: true, branches: rows });
    } catch (err) {
        console.error('Branches fetch error:', err);
        return res.status(500).json({ success: false, message: 'Server error with branches: ' + err.message });
    }
};
