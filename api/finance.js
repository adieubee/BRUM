const { getPool, ensureSchema } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');

function safeProducts(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();

        // --- POST NEW POS TRANSACTION --- (staff or owner only)
        if (url.includes('/transaction')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const authUser = requireAuth(req, res, ['owner', 'staff']);
            if (!authUser) return;

            const {
                appointment_id, branch_id: requestedBranchId, service_price,
                cash_received, change_due, products_bought, total_amount,
                payment_method, staff_id
            } = req.body || {};

            const requestedProducts = safeProducts(products_bought);
            if (!appointment_id && requestedProducts.length === 0) {
                return res.status(400).json({ success: false, message: 'Select an appointment or at least one product.' });
            }
            if (!staff_id) {
                return res.status(400).json({ success: false, message: 'A staff member is required for the transaction.' });
            }

            const connection = await pool.getConnection();
            try {
                await connection.beginTransaction();

                const [staffRows] = await connection.query(`
                    SELECT s.staff_id, s.branch_id, u.user_id, u.name
                    FROM staff s
                    JOIN users u ON s.user_id = u.user_id
                    WHERE u.user_id = ?
                    LIMIT 1
                `, [staff_id]);
                if (!staffRows.length) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Selected staff member was not found.' });
                }
                const staff = staffRows[0];

                // Staff users can only process transactions for their own branch
                if (authUser.role === 'staff' && Number(authUser.branch_id) !== Number(staff.branch_id)) {
                    await connection.rollback();
                    return res.status(403).json({ success: false, message: 'You can only process transactions for your own branch.' });
                }

                let appointment = null;
                let branchId = requestedBranchId ? Number(requestedBranchId) : null;
                if (appointment_id) {
                    const [appointmentRows] = await connection.query(`
                        SELECT appointment_id, branch_id, status, dp_paid
                        FROM appointments
                        WHERE appointment_id = ?
                        FOR UPDATE
                    `, [appointment_id]);
                    if (!appointmentRows.length) {
                        await connection.rollback();
                        return res.status(404).json({ success: false, message: 'Appointment not found.' });
                    }
                    appointment = appointmentRows[0];
                    if (appointment.status === 'Completed') {
                        await connection.rollback();
                        return res.status(409).json({ success: false, message: 'This appointment has already been checked out.' });
                    }
                    if (appointment.status === 'Cancelled') {
                        await connection.rollback();
                        return res.status(409).json({ success: false, message: 'Cancelled appointments cannot be checked out.' });
                    }
                    branchId = appointment.branch_id;

                    // Staff can only checkout appointments from their own branch
                    if (authUser.role === 'staff' && Number(authUser.branch_id) !== Number(branchId)) {
                        await connection.rollback();
                        return res.status(403).json({ success: false, message: 'You can only checkout appointments from your own branch.' });
                    }
                }

                if (branchId && Number(staff.branch_id) !== Number(branchId)) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Selected staff member belongs to a different branch.' });
                }

                const normalizedProducts = [];
                let productsTotal = 0;
                let productsBranchId = null;

                for (const requested of requestedProducts) {
                    const inventoryId = Number.parseInt(requested.inventory_id, 10);
                    const quantity = Math.max(1, Number.parseInt(requested.quantity, 10) || 1);
                    if (!inventoryId) continue;

                    const [itemRows] = await connection.query(`
                        SELECT inventory_id, branch_id, item_name, price, quantity
                        FROM inventory
                        WHERE inventory_id = ?
                        FOR UPDATE
                    `, [inventoryId]);
                    if (!itemRows.length) {
                        await connection.rollback();
                        return res.status(404).json({ success: false, message: `Inventory item ${inventoryId} was not found.` });
                    }

                    const item = itemRows[0];
                    if (Number(item.quantity) < quantity) {
                        await connection.rollback();
                        return res.status(409).json({ success: false, message: `Not enough stock for ${item.item_name}.` });
                    }

                    if (productsBranchId === null) productsBranchId = Number(item.branch_id);
                    if (productsBranchId !== Number(item.branch_id)) {
                        await connection.rollback();
                        return res.status(400).json({ success: false, message: 'A single transaction cannot mix products from different branches.' });
                    }
                    if (branchId && Number(item.branch_id) !== Number(branchId)) {
                        await connection.rollback();
                        return res.status(400).json({ success: false, message: `${item.item_name} belongs to a different branch.` });
                    }

                    const unitPrice = Number(item.price) || 0;
                    productsTotal += unitPrice * quantity;
                    normalizedProducts.push({
                        inventory_id: item.inventory_id,
                        item_name: item.item_name,
                        quantity,
                        price_each: unitPrice
                    });
                }

                if (!branchId) branchId = productsBranchId || Number(staff.branch_id);
                if (Number(staff.branch_id) !== Number(branchId)) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Transaction branch does not match the selected staff member.' });
                }

                const serviceAmount = Math.max(0, Number(service_price) || 0);
                const grossAmount = serviceAmount + productsTotal;
                const amountDue = Math.max(0, Number(total_amount) || grossAmount);
                const cashReceived = Math.max(0, Number(cash_received) || 0);
                const changeDue = Math.max(0, Number(change_due) || 0);

                if (cashReceived < amountDue) {
                    await connection.rollback();
                    return res.status(400).json({ success: false, message: 'Cash received is less than the amount due.' });
                }

                if (appointment) {
                    await connection.query(
                        'UPDATE appointments SET status = ?, staff_id = ? WHERE appointment_id = ?',
                        ['Completed', staff.staff_id, appointment_id]
                    );
                }

                // Store the FULL gross amount (including DP already paid) as revenue
                const [financeResult] = await connection.query(`
                    INSERT INTO finance (
                        appointment_id, branch_id, staff_id, amount, amount_due,
                        cash_received, change_due, products_bought, payment_method
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    appointment_id || null, branchId, staff.user_id, grossAmount, amountDue,
                    cashReceived, changeDue, JSON.stringify(normalizedProducts), payment_method || 'Cash'
                ]);

                for (const product of normalizedProducts) {
                    await connection.query(`
                        UPDATE inventory
                        SET quantity = quantity - ?,
                            status = CASE
                                WHEN quantity - ? < 3 THEN 'Critical'
                                WHEN quantity - ? < 10 THEN 'Low Stock'
                                ELSE 'Good'
                            END
                        WHERE inventory_id = ?
                    `, [product.quantity, product.quantity, product.quantity, product.inventory_id]);
                }

                await connection.commit();
                return res.status(200).json({
                    success: true,
                    transaction_id: financeResult.insertId,
                    total_amount: grossAmount,
                    amount_due: amountDue,
                    message: 'Transaction completed successfully.'
                });
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }
        }

        // --- GET COMMISSIONS --- (owner only)
        if (url.includes('/commissions')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const authUser = requireAuth(req, res, ['owner']);
            if (!authUser) return;

            const { start_date, end_date } = req.query || {};

            const [staffRows] = await pool.query(`
                SELECT u.user_id AS staff_user_id, u.name AS staff_name, s.staff_id, s.branch_id, b.name AS branch_name
                FROM staff s
                JOIN users u ON s.user_id = u.user_id
                LEFT JOIN branches b ON s.branch_id = b.branch_id
                ORDER BY u.name
            `);

            let query = `
                SELECT f.transaction_id, f.amount, f.products_bought, f.created_at,
                       DATE_FORMAT(f.created_at, '%Y-%m-%d') AS work_date, f.staff_id,
                       a.service_ids
                FROM finance f
                LEFT JOIN appointments a ON f.appointment_id = a.appointment_id
                WHERE f.staff_id IS NOT NULL
            `;
            const params = [];
            if (start_date) {
                query += ' AND DATE(f.created_at) >= ?';
                params.push(start_date);
            }
            if (end_date) {
                query += ' AND DATE(f.created_at) <= ?';
                params.push(end_date);
            }
            query += ' ORDER BY f.created_at';

            const [transactions] = await pool.query(query, params);
            const [allServices] = await pool.query('SELECT service_id, name, category FROM services');
            const serviceMap = new Map(allServices.map(service => [String(service.service_id), service]));

            const staffStats = new Map();
            staffRows.forEach(staff => {
                staffStats.set(String(staff.staff_user_id), {
                    staff_id: staff.staff_user_id,
                    staff_name: staff.staff_name,
                    branch_name: staff.branch_name || 'Unassigned',
                    transaction_count: 0,
                    total_sales: 0,
                    unique_days: new Set(),
                    commission_products: 0,
                    commission_services: 0
                });
            });

            transactions.forEach(transaction => {
                const key = String(transaction.staff_id);
                const stats = staffStats.get(key);
                if (!stats) return;

                stats.transaction_count += 1;
                stats.total_sales += Number(transaction.amount) || 0;
                stats.unique_days.add(String(transaction.work_date));

                safeProducts(transaction.products_bought).forEach(product => {
                    const itemName = String(product.item_name || '').toLowerCase();
                    const qty = Math.max(1, Number.parseInt(product.quantity, 10) || 1);
                    stats.commission_products += itemName.includes('soap') ? 10 * qty : 20 * qty;
                });

                if (transaction.service_ids) {
                    String(transaction.service_ids).split(',').map(id => id.trim()).filter(Boolean).forEach(id => {
                        const service = serviceMap.get(String(id));
                        if (!service) return;
                        const category = String(service.category || '').toLowerCase();
                        const name = String(service.name || '').toLowerCase();
                        if (category.includes('combination') || category.includes('combo') || name.includes('combo')) {
                            stats.commission_services += 50;
                        }
                    });
                }
            });

            const results = Array.from(staffStats.values()).map(stats => {
                const daysWorked = stats.unique_days.size;
                const basePay = daysWorked * 695;
                const totalPayout = basePay + stats.commission_products + stats.commission_services;
                return {
                    staff_id: stats.staff_id,
                    staff_name: stats.staff_name,
                    branch_name: stats.branch_name,
                    transaction_count: stats.transaction_count,
                    total_sales: Number(stats.total_sales.toFixed(2)),
                    days_worked: daysWorked,
                    base_pay: basePay,
                    commission_products: stats.commission_products,
                    commission_services: stats.commission_services,
                    total_payout: totalPayout
                };
            });

            return res.status(200).json({ success: true, commissions: results });
        }

        // --- GET ALL TRANSACTIONS --- (owner or staff — staff sees own branch only)
        if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
        const authUser = requireAuth(req, res, ['owner', 'staff']);
        if (!authUser) return;

        let query = `
            SELECT f.*, f.amount AS total_amount,
                   COALESCE(f.branch_id, a.branch_id) AS branch_id,
                   b.name AS branch_name,
                   u.name AS staff_name
            FROM finance f
            LEFT JOIN appointments a ON f.appointment_id = a.appointment_id
            LEFT JOIN branches b ON COALESCE(f.branch_id, a.branch_id) = b.branch_id
            LEFT JOIN users u ON f.staff_id = u.user_id
        `;
        const params = [];
        if (authUser.role === 'staff' && authUser.branch_id) {
            query += ' WHERE COALESCE(f.branch_id, a.branch_id) = ?';
            params.push(authUser.branch_id);
        }
        query += ' ORDER BY f.created_at DESC';

        const [rows] = await pool.query(query, params);
        return res.status(200).json({ success: true, transactions: rows });
    } catch (err) {
        console.error('Finance API error:', err);
        return res.status(500).json({ success: false, message: 'Server error with finance: ' + err.message });
    }
};
