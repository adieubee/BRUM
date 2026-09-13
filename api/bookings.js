const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        // --- GET FORM DATA ---
        if (url.includes('/form-data')) {
            if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
            const [branchesResult, servicesResult, staffResult] = await Promise.all([
                pool.query('SELECT * FROM branches ORDER BY branch_id'),
                pool.query('SELECT * FROM services ORDER BY service_id'),
                pool.query('SELECT s.*, u.name as staff_name FROM staff s JOIN users u ON s.user_id = u.user_id')
            ]);
            return res.status(200).json({
                success: true,
                branches: branchesResult[0],
                services: servicesResult[0],
                staff: staffResult[0]
            });
        }

        // --- CREATE BOOKING ---
        else if (url.includes('/create')) {
            if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
            const { client_id, branch_id, service_id, service_ids, staff_id, date, time, message, pax } = req.body;

            let ids = service_ids && service_ids.length > 0 ? service_ids : (service_id ? [service_id] : []);
            ids = ids.map(id => String(id).trim()).filter(Boolean);

            if (!client_id || !branch_id || ids.length === 0 || !date || !time) {
                return res.status(400).json({ success: false, message: 'All booking fields are required.' });
            }
            const assignedStaff = (staff_id && staff_id !== '0') ? staff_id : null;
            const paxCount = pax || 1;
            const serviceIdsStr = ids.join(',');
            const primaryServiceId = ids[0];

            const [result] = await pool.query(
                `INSERT INTO appointments (client_id, branch_id, service_id, service_ids, pax, staff_id, appointment_date, appointment_time, status, message)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?)`,
                [client_id, branch_id, primaryServiceId, serviceIdsStr, paxCount, assignedStaff, date, time, message || null]
            );

            return res.status(201).json({
                success: true,
                appointment_id: result.insertId,
                message: 'Appointment booked and confirmed successfully.'
            });
        }

        // --- GET CLIENT BOOKINGS ---
        else if (url.includes('/my')) {
            if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
            const { client_id } = req.query;
            if (!client_id) return res.status(400).json({ success: false, message: 'client_id is required.' });

            const [rows] = await pool.query(
                `SELECT a.*, s.name AS service_name, s.price AS service_price, b.name AS branch_name
                 FROM appointments a
                 JOIN services s ON a.service_id = s.service_id
                 JOIN branches b ON a.branch_id = b.branch_id
                 WHERE a.client_id = ?
                 ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
                [client_id]
            );

            return res.status(200).json({ success: true, appointments: rows });
        }

        // --- GET BRANCH BOOKINGS ---
        else if (url.includes('/branch')) {
            if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });
            const { branch_id } = req.query;
            let query = `
                SELECT a.*, u.name AS client_name, u.phone AS client_phone,
                       s.name AS service_name, s.price AS service_price,
                       b.name AS branch_name
                FROM appointments a
                JOIN users u ON a.client_id = u.user_id
                JOIN services s ON a.service_id = s.service_id
                JOIN branches b ON a.branch_id = b.branch_id
            `;
            const params = [];
            if (branch_id) {
                query += ' WHERE a.branch_id = ?';
                params.push(branch_id);
            }
            query += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC';
            const [rows] = await pool.query(query, params);

            return res.status(200).json({ success: true, appointments: rows });
        }

        // --- UPDATE STATUS ---
        else if (url.includes('/status')) {
            if (req.method !== 'PUT') return res.status(405).json({ message: 'Method not allowed' });
            const { appointment_id, status } = req.body;
            const valid = ['Confirmed', 'In-Progress', 'Completed', 'Cancelled'];
            if (!appointment_id || !status || !valid.includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid payload or status.' });
            }

            const [result] = await pool.query('UPDATE appointments SET status = ? WHERE appointment_id = ?', [status, appointment_id]);
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Appointment not found.' });

            return res.status(200).json({ success: true, message: `Status updated to ${status}.` });
        }

        else {
            return res.status(404).json({ success: false, message: 'Booking route not found' });
        }
    } catch (err) {
        console.error('Bookings API error:', err);
        return res.status(500).json({ success: false, message: 'Server error with bookings.' });
    }
};