const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        // --- POST NEW TRANSACTION ---
        if (url.includes('/transaction')) {
            if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
            const {
                branch_id, appointment_id, client_name, service_name, service_price,
                products_total, cash_received, change_due, products_bought, total_amount, payment_method, staff_id
            } = req.body;

            if (!appointment_id || cash_received === undefined) {
                return res.status(400).json({ success: false, message: 'Missing required fields.' });
            }

            // 1. Update appointment to Completed and assign staff
            if (staff_id) {
                const [staffRows] = await pool.query('SELECT staff_id FROM staff WHERE user_id = ?', [staff_id]);
                const actualStaffId = staffRows.length > 0 ? staffRows[0].staff_id : null;
                await pool.query('UPDATE appointments SET status = ?, staff_id = ? WHERE appointment_id = ?', ['Completed', actualStaffId, appointment_id]);
            } else {
                await pool.query('UPDATE appointments SET status = ? WHERE appointment_id = ?', ['Completed', appointment_id]);
            }

            // 2. Insert into finance table
            const insertQuery = `
                INSERT INTO finance (
                    appointment_id, amount, cash_received, change_due,
                    products_bought, payment_method, staff_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            await pool.query(insertQuery, [
                appointment_id, total_amount, cash_received, change_due,
                JSON.stringify(products_bought || []), payment_method || 'Cash', staff_id || null
            ]);

            // 3. Deduct Inventory
            if (products_bought && products_bought.length > 0) {
                for (const prod of products_bought) {
                    if (prod.inventory_id && prod.quantity) {
                        await pool.query(
                            'UPDATE inventory SET quantity = quantity - ? WHERE inventory_id = ?',
                            [prod.quantity, prod.inventory_id]
                        );
                        // Auto-update status
                        await pool.query(
                            `UPDATE inventory SET status = CASE 
                                WHEN quantity < 3 THEN 'Critical'
                                WHEN quantity < 10 THEN 'Low Stock'
                                ELSE 'Good' 
                             END WHERE inventory_id = ?`,
                            [prod.inventory_id]
                        );
                    }
                }
            }
            return res.status(200).json({ success: true, message: 'Transaction completed successfully.' });
        }

        // --- GET COMMISSIONS ---
        else if (url.includes('/commissions')) {
            if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
            const { start_date, end_date } = req.query;

            let query = `
                SELECT 
                    f.transaction_id, f.amount, f.products_bought, f.created_at, f.staff_id,
                    u.name AS staff_name,
                    a.service_ids
                FROM finance f
                JOIN users u ON f.staff_id = u.user_id
                LEFT JOIN appointments a ON f.appointment_id = a.appointment_id
                WHERE f.staff_id IS NOT NULL
            `;
            const params = [];

            if (start_date && end_date) {
                query += ' AND DATE(f.created_at) BETWEEN ? AND ?';
                params.push(start_date, end_date);
            }

            const [transactions] = await pool.query(query, params);

            // To check if a service is a combination or hydra facial, we fetch all services once
            const [allServices] = await pool.query('SELECT service_id, name, category FROM services');
            const serviceMap = {};
            allServices.forEach(s => serviceMap[s.service_id] = s);

            const staffStats = {};

            transactions.forEach(t => {
                const staffId = t.staff_id;
                if (!staffStats[staffId]) {
                    staffStats[staffId] = {
                        staff_name: t.staff_name,
                        transaction_count: 0,
                        total_sales: 0,
                        unique_days: new Set(),
                        commission_products: 0,
                        commission_services: 0
                    };
                }

                const stats = staffStats[staffId];
                stats.transaction_count++;
                stats.total_sales += parseFloat(t.amount);

                // Track unique days for base pay
                const dateStr = new Date(t.created_at).toISOString().split('T')[0];
                stats.unique_days.add(dateStr);

                // --- Calculate Product Commission ---
                let products = [];
                try {
                    products = typeof t.products_bought === 'string' ? JSON.parse(t.products_bought) : t.products_bought;
                } catch (e) { }

                if (products && products.length > 0) {
                    products.forEach(p => {
                        const isSoap = p.item_name.toLowerCase().includes('soap');
                        const qty = parseInt(p.quantity) || 1;
                        stats.commission_products += isSoap ? (10 * qty) : (20 * qty);
                    });
                }

                // --- Calculate Service Commission ---
                if (t.service_ids) {
                    const sIds = t.service_ids.split(',').map(id => id.trim());
                    sIds.forEach(id => {
                        const srv = serviceMap[id];
                        if (srv) {
                            const cat = (srv.category || '').toLowerCase();
                            const name = (srv.name || '').toLowerCase();
                            if (cat.includes('combination')) {
                                stats.commission_services += 50;
                            } else if (name.includes('hydra')) {
                                stats.commission_services += 50;
                            }
                        }
                    });
                }
            });

            // Format final output
            const results = Object.values(staffStats).map(s => {
                const daysWorked = s.unique_days.size;
                const basePay = daysWorked * 695;
                const totalPayout = basePay + s.commission_products + s.commission_services;

                return {
                    staff_name: s.staff_name,
                    transaction_count: s.transaction_count,
                    total_sales: s.total_sales,
                    days_worked: daysWorked,
                    base_pay: basePay,
                    commission_products: s.commission_products,
                    commission_services: s.commission_services,
                    total_payout: totalPayout
                };
            });

            return res.status(200).json({ success: true, commissions: results });
        }

        // --- GET ALL TRANSACTIONS (Default /finance) ---
        else {
            if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
            const [rows] = await pool.query(`
                SELECT f.*, f.amount AS total_amount, a.branch_id, b.name AS branch_name 
                FROM finance f
                LEFT JOIN appointments a ON f.appointment_id = a.appointment_id
                LEFT JOIN branches b ON a.branch_id = b.branch_id
                ORDER BY f.created_at DESC
            `);
            return res.status(200).json({ success: true, transactions: rows });
        }
    } catch (err) {
        console.error('Error fetching/posting finance:', err);
        return res.status(500).json({ success: false, message: 'Server error with finance: ' + err.message });
    }
};
