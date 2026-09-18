const { getPool, ensureSchema } = require('./_lib/db');

function stockStatus(quantity) {
    if (quantity < 3) return 'Critical';
    if (quantity < 10) return 'Low Stock';
    return 'Good';
}

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();

        if (url.includes('/add')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

            const { item_name, unit, price, branch_id } = req.body || {};
            const quantityRaw = req.body?.quantity ?? req.body?.quantitiy;
            const quantity = Number.parseInt(quantityRaw, 10);

            if (!item_name || !unit || !Number.isFinite(quantity) || quantity < 0 || !branch_id) {
                return res.status(400).json({ success: false, message: 'item_name, unit, quantity, and branch_id are required.' });
            }

            const [result] = await pool.query(
                'INSERT INTO inventory (item_name, unit, price, quantity, status, branch_id) VALUES (?, ?, ?, ?, ?, ?)',
                [String(item_name).trim(), String(unit).trim(), Number(price) || 0, quantity, stockStatus(quantity), branch_id]
            );

            return res.status(201).json({ success: true, message: 'Product added successfully.', inventory_id: result.insertId });
        }

        if (url.includes('/restock')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });

            const { inventory_id } = req.body || {};
            const quantityRaw = req.body?.quantity ?? req.body?.quantitiy;
            const quantity = Number.parseInt(quantityRaw, 10);

            if (!inventory_id || !Number.isFinite(quantity) || quantity < 0) {
                return res.status(400).json({ success: false, message: 'inventory_id and a non-negative quantity are required.' });
            }

            const [result] = await pool.query(
                'UPDATE inventory SET quantity = ?, status = ? WHERE inventory_id = ?',
                [quantity, stockStatus(quantity), inventory_id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Item not found.' });
            }
            return res.status(200).json({ success: true, message: `Stock updated to ${quantity}. Status: ${stockStatus(quantity)}` });
        }

        if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });

        const { branch_id } = req.query || {};
        let query = `
            SELECT i.*, b.name AS branch_name
            FROM inventory i
            JOIN branches b ON i.branch_id = b.branch_id
        `;
        const params = [];
        if (branch_id) {
            query += ' WHERE i.branch_id = ?';
            params.push(branch_id);
        }
        query += ' ORDER BY b.name, i.item_name';

        const [rows] = await pool.query(query, params);
        return res.status(200).json({ success: true, inventory: rows });
    } catch (err) {
        console.error('Inventory error:', err);
        return res.status(500).json({ success: false, message: 'Server error with inventory: ' + err.message });
    }
};
