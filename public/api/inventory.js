const { getPool, ensureSchema } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');

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
            const authUser = requireAuth(req, res, ['owner', 'staff']);
            if (!authUser) return;

            const { item_name, unit, price, branch_id } = req.body || {};
            const quantityRaw = req.body?.quantity ?? req.body?.quantitiy;
            const quantity = Number.parseInt(quantityRaw, 10);

            if (!item_name || !unit || !Number.isFinite(quantity) || quantity < 0 || !branch_id) {
                return res.status(400).json({ success: false, message: 'item_name, unit, quantity, and branch_id are required.' });
            }

            // Staff can only add items to their own branch
            if (authUser.role === 'staff' && Number(authUser.branch_id) !== Number(branch_id)) {
                return res.status(403).json({ success: false, message: 'You can only add inventory items for your own branch.' });
            }

            const [result] = await pool.query(
                'INSERT INTO inventory (item_name, unit, price, quantity, status, branch_id) VALUES (?, ?, ?, ?, ?, ?)',
                [String(item_name).trim(), String(unit).trim(), Number(price) || 0, quantity, stockStatus(quantity), branch_id]
            );

            return res.status(201).json({ success: true, message: 'Product added successfully.', inventory_id: result.insertId });
        }

        if (url.includes('/restock')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const authUser = requireAuth(req, res, ['owner', 'staff']);
            if (!authUser) return;

            const { inventory_id } = req.body || {};
            // Accept 'delta' (positive or negative adjustment) instead of absolute quantity
            // to prevent race conditions. If 'delta' not provided, fall back to absolute 'quantity'
            // for backward compatibility, but only accept non-negative absolute values.
            const hasDelta = req.body?.delta !== undefined;
            let newQuantity;

            if (hasDelta) {
                const delta = Number.parseInt(req.body.delta, 10);
                if (!inventory_id || !Number.isFinite(delta)) {
                    return res.status(400).json({ success: false, message: 'inventory_id and a numeric delta are required.' });
                }

                // Verify item belongs to this staff's branch
                if (authUser.role === 'staff' && authUser.branch_id) {
                    const [itemCheck] = await pool.query('SELECT branch_id FROM inventory WHERE inventory_id = ? LIMIT 1', [inventory_id]);
                    if (!itemCheck.length) return res.status(404).json({ success: false, message: 'Item not found.' });
                    if (Number(itemCheck[0].branch_id) !== Number(authUser.branch_id)) {
                        return res.status(403).json({ success: false, message: 'You can only restock items for your own branch.' });
                    }
                }

                const [result] = await pool.query(`
                    UPDATE inventory
                    SET quantity = GREATEST(0, quantity + ?),
                        status = CASE
                            WHEN GREATEST(0, quantity + ?) < 3 THEN 'Critical'
                            WHEN GREATEST(0, quantity + ?) < 10 THEN 'Low Stock'
                            ELSE 'Good'
                        END
                    WHERE inventory_id = ?
                `, [delta, delta, delta, inventory_id]);

                if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Item not found.' });
                const [updated] = await pool.query('SELECT quantity, status FROM inventory WHERE inventory_id = ?', [inventory_id]);
                const q = updated[0]?.quantity ?? 0;
                return res.status(200).json({ success: true, message: `Stock updated to ${q}. Status: ${stockStatus(q)}` });
            } else {
                // Absolute restock (owner only, for deliberate stock-setting)
                if (authUser.role !== 'owner') {
                    return res.status(403).json({ success: false, message: 'Only owners can set absolute stock levels. Use delta instead.' });
                }
                const quantityRaw = req.body?.quantity ?? req.body?.quantitiy;
                const quantity = Number.parseInt(quantityRaw, 10);
                if (!inventory_id || !Number.isFinite(quantity) || quantity < 0) {
                    return res.status(400).json({ success: false, message: 'inventory_id and a non-negative quantity are required.' });
                }
                const [result] = await pool.query(
                    'UPDATE inventory SET quantity = ?, status = ? WHERE inventory_id = ?',
                    [quantity, stockStatus(quantity), inventory_id]
                );
                if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Item not found.' });
                return res.status(200).json({ success: true, message: `Stock updated to ${quantity}. Status: ${stockStatus(quantity)}` });
            }
        }

        // GET inventory — authenticated, staff filtered by branch
        if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
        const authUser = requireAuth(req, res, ['owner', 'staff']);
        if (!authUser) return;

        let { branch_id } = req.query || {};

        // Staff can only see their own branch's inventory
        if (authUser.role === 'staff' && authUser.branch_id) {
            branch_id = authUser.branch_id;
        }

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
