const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        // --- ADD NEW PRODUCT ---
        if (url.includes('/add')) {
            if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
            const { item_name, unit, price, quantitiy, branch_id } = req.body;
            if (!item_name || !unit || quantitiy === undefined || !branch_id) {
                return res.status(400).json({ success: false, message: 'item_name, unit, quantitiy, and branch_id are required.' });
            }

            let status = 'Good';
            if (quantitiy < 3) status = 'Critical';
            else if (quantitiy < 10) status = 'Low Stock';

            const [result] = await pool.query(
                'INSERT INTO inventory (item_name, unit, price, quantitiy, status, branch_id) VALUES (?, ?, ?, ?, ?, ?)',
                [item_name, unit, price || 0, quantitiy, status, branch_id]
            );

            return res.status(201).json({ success: true, message: 'Product added successfully.', inventory_id: result.insertId });
        }

        // --- RESTOCK ITEM ---
        if (url.includes('/restock')) {
            if (req.method !== 'PUT') return res.status(405).json({ message: 'Method not allowed' });
            const { inventory_id, quantitiy } = req.body;
            if (!inventory_id || quantitiy === undefined) {
                return res.status(400).json({ success: false, message: 'inventory_id and quantitiy are required.' });
            }

            let status = 'Good';
            if (quantitiy < 3) status = 'Critical';
            else if (quantitiy < 10) status = 'Low Stock';

            const [result] = await pool.query(
                'UPDATE inventory SET quantitiy = ?, status = ? WHERE inventory_id = ?',
                [quantitiy, status, inventory_id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Item not found.' });
            }
            return res.status(200).json({ success: true, message: `Stock updated to ${quantitiy}. Status: ${status}` });
        }

        // --- GET INVENTORY ---
        else {
            if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
            const { branch_id } = req.query;
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
        }
    } catch (err) {
        console.error('Inventory error:', err);
        return res.status(500).json({ success: false, message: 'Server error with inventory.' });
    }
};