const { getPool, ensureSchema } = require('./_lib/db');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
    try {
        await ensureSchema();
        const [rows] = await getPool().query('SELECT * FROM services ORDER BY category, service_id');
        return res.status(200).json({ success: true, services: rows });
    } catch (err) {
        console.error('Services fetch error:', err);
        return res.status(500).json({ success: false, message: 'Server error with services: ' + err.message });
    }
};
