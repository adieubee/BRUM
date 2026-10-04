const bcrypt = require('bcryptjs');
const { getPool, ensureSchema } = require('./_lib/db');
const { sendEmail, generateBookingConfirmationEmail, formatEmailDate, formatEmailTime } = require('./_lib/email');

const VALID_STATUSES = ['Pending Payment', 'Pending Reschedule', 'Confirmed', 'In-Progress', 'Completed', 'Cancelled'];

function normalizeServiceIds(serviceIds, serviceId) {
    const source = Array.isArray(serviceIds) && serviceIds.length ? serviceIds : (serviceId ? [serviceId] : []);
    return source.map(id => String(id).trim()).filter(id => /^\d+$/.test(id));
}

function timeToHHMMSS(value) {
    if (!value) return value;
    const text = String(value);
    return text.length === 5 ? `${text}:00` : text;
}

async function getServiceMap(pool) {
    const [services] = await pool.query('SELECT service_id, name, category, price, duration_minutes FROM services');
    const map = new Map();
    services.forEach(service => map.set(String(service.service_id), service));
    return map;
}

async function enrichAppointments(pool, rows) {
    if (!rows.length) return rows;
    const serviceMap = await getServiceMap(pool);

    return rows.map(row => {
        const ids = normalizeServiceIds(row.service_ids ? String(row.service_ids).split(',') : [], row.service_id);
        const serviceRows = ids.map(id => serviceMap.get(String(id))).filter(Boolean);
        const names = serviceRows.map(service => service.name);
        const totalPrice = serviceRows.reduce((sum, service) => sum + (Number(service.price) || 0), 0);
        const nonWartsPrice = serviceRows.reduce((sum, service) => {
            return String(service.name).toLowerCase().includes('warts removal') ? sum : sum + (Number(service.price) || 0);
        }, 0);

        return {
            ...row,
            all_service_names: names.length ? names.join(', ') : row.service_name,
            total_service_price: totalPrice,
            non_warts_price: Number(row.non_warts_price ?? nonWartsPrice) || 0
        };
    });
}

async function validateServices(pool, ids) {
    if (!ids.length) return { valid: false, serviceMap: new Map(), serviceRows: [] };
    const serviceMap = await getServiceMap(pool);
    const serviceRows = ids.map(id => serviceMap.get(String(id))).filter(Boolean);
    return { valid: serviceRows.length === ids.length, serviceMap, serviceRows };
}

async function staffBelongsToBranch(pool, staffId, branchId) {
    if (!staffId) return true;
    const [rows] = await pool.query('SELECT staff_id FROM staff WHERE staff_id = ? AND branch_id = ? LIMIT 1', [staffId, branchId]);
    return rows.length > 0;
}

async function isStaffTimeAvailable(pool, branchId, staffId, date, time, excludedAppointmentId = null) {
    if (!staffId) return true;
    let query = `
        SELECT appointment_id FROM appointments
        WHERE branch_id = ? AND staff_id = ? AND appointment_date = ? AND appointment_time = ?
          AND status NOT IN ('Cancelled', 'Completed')
    `;
    const params = [branchId, staffId, date, timeToHHMMSS(time)];
    if (excludedAppointmentId) {
        query += ' AND appointment_id <> ?';
        params.push(excludedAppointmentId);
    }
    query += ' LIMIT 1';
    const [rows] = await pool.query(query, params);
    return rows.length === 0;
}

async function logBookingHistory(pool, { appointmentId, action, previousStatus = null, newStatus = null, changedBy = null, details = null }) {
    if (!appointmentId) return;
    await pool.query(
        `INSERT INTO booking_history (appointment_id, action, previous_status, new_status, changed_by, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            appointmentId,
            String(action || 'updated').slice(0, 50),
            previousStatus ? String(previousStatus).slice(0, 45) : null,
            newStatus ? String(newStatus).slice(0, 45) : null,
            changedBy ?? null,
            details ? String(details).slice(0, 65535) : null
        ]
    );
}

async function sendAppointmentEmail(pool, appointmentId) {
    const [rows] = await pool.query(`
        SELECT a.*, u.name AS client_name, u.email AS client_email, b.address AS branch_address
        FROM appointments a
        JOIN users u ON a.client_id = u.user_id
        JOIN branches b ON a.branch_id = b.branch_id
        WHERE a.appointment_id = ?
        LIMIT 1
    `, [appointmentId]);
    if (!rows.length || !rows[0].client_email) return false;

    const [enriched] = await enrichAppointments(pool, rows);
    const formattedDate = formatEmailDate(enriched.appointment_date);
    const formattedTime = formatEmailTime(enriched.appointment_time);
    const email = generateBookingConfirmationEmail({
        clientName: enriched.client_name,
        date: formattedDate,
        time: formattedTime,
        branchAddress: enriched.branch_address,
        services: enriched.all_service_names || enriched.service_name || '',
        bookingUrl: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/client/my-appointments.html`,
        message: enriched.message || ''
    });

    return {
        to_email: enriched.client_email,
        client_name: enriched.client_name,
        date: formattedDate,
        time: formattedTime,
        branch_address: enriched.branch_address,
        services: enriched.all_service_names || enriched.service_name || '',
        message: enriched.message || '',
        subject: email.subject,
        html: email.html
    };
}

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();

        // Data needed by the booking form.
        if (url.includes('/form-data')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const [branchesResult, servicesResult, staffResult] = await Promise.all([
                pool.query('SELECT * FROM branches ORDER BY branch_id'),
                pool.query('SELECT * FROM services ORDER BY category, service_id'),
                pool.query(`
                    SELECT s.*, u.name AS staff_name, u.username, u.email, b.name AS branch_name
                    FROM staff s
                    JOIN users u ON s.user_id = u.user_id
                    JOIN branches b ON s.branch_id = b.branch_id
                    ORDER BY u.name
                `)
            ]);
            return res.status(200).json({
                success: true,
                branches: branchesResult[0],
                services: servicesResult[0],
                staff: staffResult[0]
            });
        }

        // Used by booking/reschedule screens to disable occupied slots.
        if (url.includes('/unavailable-times')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { branch_id, date, staff_id } = req.query || {};
            if (!branch_id || !date) {
                return res.status(400).json({ success: false, message: 'branch_id and date are required.' });
            }

            let query = `
                SELECT DISTINCT appointment_time
                FROM appointments
                WHERE branch_id = ? AND appointment_date = ?
                  AND status NOT IN ('Cancelled', 'Completed')
            `;
            const params = [branch_id, date];
            if (staff_id && staff_id !== '0' && staff_id !== 'null') {
                query += ' AND staff_id = ?';
                params.push(staff_id);
            }
            query += ' ORDER BY appointment_time';

            const [rows] = await pool.query(query, params);
            return res.status(200).json({
                success: true,
                unavailable_times: rows.map(row => String(row.appointment_time))
            });
        }

        // Client booking creation. This project uses a local demo confirmation page rather than a live payment gateway.
        if (url.includes('/create')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { client_id, branch_id, service_id, service_ids, staff_id, date, time, message, pax } = req.body || {};
            const ids = normalizeServiceIds(service_ids, service_id);
            const assignedStaff = staff_id && String(staff_id) !== '0' ? Number(staff_id) : null;
            const paxCount = Math.max(1, Number.parseInt(pax, 10) || 1);

            if (!client_id || !branch_id || !ids.length || !date || !time) {
                return res.status(400).json({ success: false, message: 'Client, branch, service, date, and time are required.' });
            }

            const [[client], [branchRows], serviceValidation] = await Promise.all([
                pool.query('SELECT user_id, name, email FROM users WHERE user_id = ? AND role = ? LIMIT 1', [client_id, 'client']).then(r => r[0]),
                pool.query('SELECT branch_id FROM branches WHERE branch_id = ? LIMIT 1', [branch_id]),
                validateServices(pool, ids)
            ]);
            if (!client) return res.status(404).json({ success: false, message: 'Client account not found.' });
            if (!branchRows.length) return res.status(404).json({ success: false, message: 'Branch not found.' });
            if (!serviceValidation.valid) return res.status(400).json({ success: false, message: 'One or more selected services are invalid.' });

            if (assignedStaff && !(await staffBelongsToBranch(pool, assignedStaff, branch_id))) {
                return res.status(400).json({ success: false, message: 'Selected staff member does not belong to this branch.' });
            }
            if (assignedStaff && !(await isStaffTimeAvailable(pool, branch_id, assignedStaff, date, time))) {
                return res.status(409).json({ success: false, message: 'That staff member is already booked for the selected time.' });
            }

            let nonWartsPrice = 0;
            let wartsCount = 0;
            serviceValidation.serviceRows.forEach(service => {
                if (String(service.name).toLowerCase().includes('warts removal')) wartsCount += 1;
                else nonWartsPrice += Number(service.price) || 0;
            });
            const wartsDp = wartsCount * 100;
            const dpPaid = Math.round(nonWartsPrice * 0.20) + wartsDp;

            const [result] = await pool.query(`
                INSERT INTO appointments (
                    client_id, branch_id, service_id, service_ids, pax, staff_id,
                    appointment_date, appointment_time, status, message,
                    dp_paid, warts_dp, non_warts_price
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending Payment', ?, ?, ?, ?)
            `, [
                client_id, branch_id, ids[0], ids.join(','), paxCount, assignedStaff,
                date, timeToHHMMSS(time), message || null,
                dpPaid, wartsDp, nonWartsPrice
            ]);

            await logBookingHistory(pool, {
                appointmentId: result.insertId,
                action: 'created',
                previousStatus: null,
                newStatus: 'Pending Payment',
                changedBy: client_id,
                details: `Booking created for ${client.name || 'client'}`
            });

            return res.status(201).json({
                success: true,
                appointment_id: result.insertId,
                down_payment: dpPaid,
                checkout_url: `/client/payment-success.html?ids=${result.insertId}`,
                message: 'Booking created. Continue to confirmation.'
            });
        }

        // Local demo payment/booking confirmation. Idempotent so refreshing the success page is safe.
        if (url.includes('/payment-success')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
            const ids = rawIds.map(id => Number.parseInt(id, 10)).filter(Number.isFinite);
            if (!ids.length) return res.status(400).json({ success: false, message: 'No appointment IDs were supplied.' });

            const placeholders = ids.map(() => '?').join(',');
            const [beforeRows] = await pool.query(`SELECT appointment_id, status FROM appointments WHERE appointment_id IN (${placeholders})`, ids);
            if (beforeRows.length !== ids.length) {
                return res.status(404).json({ success: false, message: 'One or more appointments were not found.' });
            }

            await pool.query(
                `UPDATE appointments SET status = 'Confirmed' WHERE appointment_id IN (${placeholders}) AND status = 'Pending Payment'`,
                ids
            );

            const newlyConfirmed = beforeRows.filter(row => row.status === 'Pending Payment').map(row => row.appointment_id);
            for (const id of newlyConfirmed) {
                await logBookingHistory(pool, {
                    appointmentId: id,
                    action: 'payment_confirmed',
                    previousStatus: 'Pending Payment',
                    newStatus: 'Confirmed',
                    changedBy: null,
                    details: 'Payment confirmation processed'
                });
            }
            const emailResults = await Promise.all(newlyConfirmed.map(id => sendAppointmentEmail(pool, id)));
            return res.status(200).json({
                success: true,
                confirmed_ids: ids,
                emails_sent: emailResults.filter(Boolean).length,
                email_details: emailResults[0] || null
            });
        }

        // Booking lifecycle history for audits and appointment tracking.
        if (url.includes('/history')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { appointment_id, client_id } = req.query || {};
            if (!appointment_id && !client_id) {
                return res.status(400).json({ success: false, message: 'appointment_id or client_id is required.' });
            }

            let query = `
                SELECT bh.*, u.name AS changed_by_name
                FROM booking_history bh
                LEFT JOIN users u ON bh.changed_by = u.user_id
            `;
            const params = [];
            if (appointment_id) {
                query += ' WHERE bh.appointment_id = ?';
                params.push(appointment_id);
            } else {
                query += `
                    JOIN appointments a ON bh.appointment_id = a.appointment_id
                    WHERE a.client_id = ?`;
                params.push(client_id);
            }
            query += ' ORDER BY bh.created_at DESC';

            const [rows] = await pool.query(query, params);
            return res.status(200).json({ success: true, history: rows });
        }

        // Client requests a new schedule; admin/staff can approve by changing Pending Reschedule -> Confirmed.
        if (url.includes('/request-reschedule')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { appointment_id, new_date, new_time } = req.body || {};
            if (!appointment_id || !new_date || !new_time) {
                return res.status(400).json({ success: false, message: 'appointment_id, new_date, and new_time are required.' });
            }

            const [rows] = await pool.query('SELECT branch_id, staff_id, status FROM appointments WHERE appointment_id = ? LIMIT 1', [appointment_id]);
            if (!rows.length) return res.status(404).json({ success: false, message: 'Appointment not found.' });
            if (rows[0].status === 'Cancelled' || rows[0].status === 'Completed') {
                return res.status(409).json({ success: false, message: 'Completed or cancelled appointments cannot be rescheduled.' });
            }

            if (rows[0].staff_id && !(await isStaffTimeAvailable(pool, rows[0].branch_id, rows[0].staff_id, new_date, new_time, appointment_id))) {
                return res.status(409).json({ success: false, message: 'The assigned staff member is not available at that time.' });
            }

            await pool.query(`
                UPDATE appointments
                SET appointment_date = ?, appointment_time = ?, status = 'Pending Reschedule', reschedule_requested_at = CURRENT_TIMESTAMP
                WHERE appointment_id = ?
            `, [new_date, timeToHHMMSS(new_time), appointment_id]);
            await logBookingHistory(pool, {
                appointmentId: appointment_id,
                action: 'reschedule_requested',
                previousStatus: rows[0].status,
                newStatus: 'Pending Reschedule',
                changedBy: null,
                details: `Reschedule requested for ${new_date} at ${new_time}`
            });
            return res.status(200).json({ success: true, message: 'Reschedule request submitted.' });
        }

        // Admin/staff direct appointment edit.
        if (url.includes('/update')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { appointment_id, appointment_date, appointment_time, status } = req.body || {};
            if (!appointment_id || !appointment_date || !appointment_time || !status || !VALID_STATUSES.includes(status)) {
                return res.status(400).json({ success: false, message: 'A valid appointment, date, time, and status are required.' });
            }

            const [existing] = await pool.query('SELECT status FROM appointments WHERE appointment_id = ? LIMIT 1', [appointment_id]);
            if (!existing.length) return res.status(404).json({ success: false, message: 'Appointment not found.' });

            const [result] = await pool.query(`
                UPDATE appointments
                SET appointment_date = ?, appointment_time = ?, status = ?,
                    reschedule_requested_at = CASE WHEN ? = 'Pending Reschedule' THEN reschedule_requested_at ELSE NULL END
                WHERE appointment_id = ?
            `, [appointment_date, timeToHHMMSS(appointment_time), status, status, appointment_id]);
            if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Appointment not found.' });

            await logBookingHistory(pool, {
                appointmentId: appointment_id,
                action: 'status_updated',
                previousStatus: existing[0].status,
                newStatus: status,
                changedBy: null,
                details: `Status changed from ${existing[0].status} to ${status}`
            });

            if (status === 'Confirmed' && existing[0].status !== 'Confirmed') {
                await sendAppointmentEmail(pool, appointment_id);
            }

            return res.status(200).json({ success: true, message: 'Appointment updated.' });
        }

        // Admin/staff walk-in creation. Walk-ins get/reuse a client record so the existing FK remains valid.
        if (url.includes('/walkin')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { client_name, client_email, branch_id, service_ids, staff_id, date, time, pax } = req.body || {};
            const ids = normalizeServiceIds(service_ids, null);
            const assignedStaff = staff_id ? Number(staff_id) : null;
            if (!client_name || !branch_id || !ids.length || !date || !time) {
                return res.status(400).json({ success: false, message: 'Client name, branch, service, date, and time are required.' });
            }

            const serviceValidation = await validateServices(pool, ids);
            if (!serviceValidation.valid) return res.status(400).json({ success: false, message: 'One or more services are invalid.' });
            if (assignedStaff && !(await staffBelongsToBranch(pool, assignedStaff, branch_id))) {
                return res.status(400).json({ success: false, message: 'Selected staff member does not belong to this branch.' });
            }
            if (assignedStaff && !(await isStaffTimeAvailable(pool, branch_id, assignedStaff, date, time))) {
                return res.status(409).json({ success: false, message: 'That staff member is already booked for the selected time.' });
            }

            const normalizedEmail = client_email ? String(client_email).trim().toLowerCase() : null;
            let clientId = null;
            if (normalizedEmail) {
                const [existing] = await pool.query('SELECT user_id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
                if (existing.length) clientId = existing[0].user_id;
            }
            if (!clientId) {
                const username = `walkin_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                const randomHash = await bcrypt.hash(`${username}_${Math.random()}`, 10);
                const [userResult] = await pool.query(
                    'INSERT INTO users (username, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
                    [username, normalizedEmail, randomHash, 'client', String(client_name).trim()]
                );
                clientId = userResult.insertId;
            }

            const [result] = await pool.query(`
                INSERT INTO appointments (
                    client_id, branch_id, service_id, service_ids, pax, staff_id,
                    appointment_date, appointment_time, status, message, dp_paid, warts_dp, non_warts_price
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', 'Walk-in appointment', 0, 0, 0)
            `, [clientId, branch_id, ids[0], ids.join(','), Math.max(1, Number.parseInt(pax, 10) || 1), assignedStaff, date, timeToHHMMSS(time)]);

            await logBookingHistory(pool, {
                appointmentId: result.insertId,
                action: 'created',
                previousStatus: null,
                newStatus: 'Confirmed',
                changedBy: clientId,
                details: 'Walk-in appointment created and confirmed'
            });
            await sendAppointmentEmail(pool, result.insertId);
            return res.status(201).json({ success: true, appointment_id: result.insertId, message: 'Walk-in appointment created.' });
        }

        if (url.includes('/my')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { client_id } = req.query || {};
            if (!client_id) return res.status(400).json({ success: false, message: 'client_id is required.' });

            const [rows] = await pool.query(`
                SELECT a.*, s.name AS service_name, s.price AS service_price, b.name AS branch_name,
                       su.name AS staff_name
                FROM appointments a
                JOIN services s ON a.service_id = s.service_id
                JOIN branches b ON a.branch_id = b.branch_id
                LEFT JOIN staff st ON a.staff_id = st.staff_id
                LEFT JOIN users su ON st.user_id = su.user_id
                WHERE a.client_id = ?
                ORDER BY a.appointment_date DESC, a.appointment_time DESC
            `, [client_id]);

            return res.status(200).json({ success: true, appointments: await enrichAppointments(pool, rows) });
        }

        if (url.includes('/branch')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { branch_id } = req.query || {};
            let query = `
                SELECT a.*, u.name AS client_name, u.email AS client_email,
                       s.name AS service_name, s.price AS service_price,
                       b.name AS branch_name, su.name AS staff_name
                FROM appointments a
                JOIN users u ON a.client_id = u.user_id
                JOIN services s ON a.service_id = s.service_id
                JOIN branches b ON a.branch_id = b.branch_id
                LEFT JOIN staff st ON a.staff_id = st.staff_id
                LEFT JOIN users su ON st.user_id = su.user_id
            `;
            const params = [];
            if (branch_id) {
                query += ' WHERE a.branch_id = ?';
                params.push(branch_id);
            }
            query += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC';
            const [rows] = await pool.query(query, params);

            return res.status(200).json({ success: true, appointments: await enrichAppointments(pool, rows) });
        }

        if (url.includes('/status')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const { appointment_id, status } = req.body || {};
            if (!appointment_id || !status || !VALID_STATUSES.includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid appointment or status.' });
            }

            const [existing] = await pool.query('SELECT status FROM appointments WHERE appointment_id = ? LIMIT 1', [appointment_id]);
            if (!existing.length) return res.status(404).json({ success: false, message: 'Appointment not found.' });

            const [result] = await pool.query('UPDATE appointments SET status = ? WHERE appointment_id = ?', [status, appointment_id]);
            if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Appointment not found.' });

            if (status === 'Confirmed' && existing[0].status !== 'Confirmed') {
                await sendAppointmentEmail(pool, appointment_id);
            }

            return res.status(200).json({ success: true, message: `Status updated to ${status}.` });
        }

        return res.status(404).json({ success: false, message: 'Booking route not found' });
    } catch (err) {
        console.error('Bookings API error:', err);
        return res.status(500).json({ success: false, message: 'Server error with bookings: ' + err.message });
    }
};
