const bcrypt = require('bcryptjs');
const { getPool, ensureSchema } = require('./_lib/db');
const { generateBookingConfirmationEmail, formatEmailDate, formatEmailTime, sendViaEmailJs } = require('./_lib/email');
const { requireAuth, getTokenPayload } = require('./_lib/auth');
const { audit } = require('./_lib/audit');

const VALID_STATUSES = ['Pending Payment', 'Pending Reschedule', 'Confirmed', 'In-Progress', 'Completed', 'Cancelled', 'Rejected'];
const ALLOWED_TRANSITIONS = {
    'Pending Payment':['Confirmed','Cancelled'],
    'Pending Reschedule':['Confirmed','Cancelled'],
    'Confirmed':['In-Progress','Completed','Cancelled'],
    'In-Progress':['Completed','Cancelled']
};
function validStatusChange(before,after){return before===after||(ALLOWED_TRANSITIONS[before]||[]).includes(after);}


function normalizeServiceIds(serviceIds, serviceId) {
    const source = Array.isArray(serviceIds) && serviceIds.length ? serviceIds : (serviceId ? [serviceId] : []);
    return source.map(id => String(id).trim()).filter(id => /^\d+$/.test(id));
}

function validDateTime(date, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(time))) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function isFutureSlot(date, time) {
    if (!validDateTime(date,time)) return false;
    const normalized = timeToHHMMSS(time);
    return Date.parse(`${date}T${normalized}+08:00`) >= Date.now();
}
function timeMinutes(time) {
    const [h, m] = String(time).split(':').map(Number);
    return h * 60 + m;
}
function isStaffScope(user, branchId) {
    return user.role !== 'staff' || (user.branch_id != null && Number(user.branch_id) === Number(branchId));
}
async function checkStaffSchedule(pool, staffId, date, start, duration = 30) {
    if (!staffId) return true;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const [shifts] = await pool.query('SELECT weekday,start_time,end_time FROM staff_availability WHERE staff_id = ? AND is_active = 1', [staffId]);
    if (!shifts.length) return true; // No published timetable: manual approval required at assignment.
    return shifts.some(s => Number(s.weekday) === weekday && timeMinutes(start) >= timeMinutes(s.start_time) && timeMinutes(start) + duration <= timeMinutes(s.end_time));
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
    const [rows] = await pool.query("SELECT s.staff_id FROM staff s JOIN users u ON u.user_id=s.user_id WHERE s.staff_id = ? AND s.branch_id = ? AND s.is_active=1 AND u.role='staff' LIMIT 1", [staffId, branchId]);
    return rows.length > 0;
}

async function barberQualified(pool, staffId, serviceIds) {
    const ids = [...new Set(serviceIds.map(Number))];
    if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return false;
    const [rows] = await pool.query('SELECT service_id FROM staff_services WHERE staff_id=?', [staffId]);
    const skills = new Set(rows.map(r => Number(r.service_id)));
    return ids.every(id => skills.has(id));
}
async function appointmentSkillIds(pool, appointmentId) {
    const [rows] = await pool.query('SELECT service_id FROM appointment_services WHERE appointment_id=?',[appointmentId]);
    return rows.map(r => Number(r.service_id));
}
async function isStaffTimeAvailable(pool, branchId, staffId, date, time, excludedAppointmentId = null, duration = 30) {
    if (!staffId) return true;
    if (!validDateTime(date, time)) return false;
    if (!(await checkStaffSchedule(pool, staffId, date, time, duration))) return false;
    const params = [branchId, staffId, date];
    let query = `SELECT a.appointment_id, a.appointment_time,
        COALESCE(SUM(ps.duration_minutes * aps.quantity), MAX(s.duration_minutes), 30) AS duration_minutes
        FROM appointments a
        JOIN services s ON s.service_id = a.service_id
        LEFT JOIN appointment_services aps ON aps.appointment_id = a.appointment_id
        LEFT JOIN services ps ON ps.service_id = aps.service_id
        WHERE a.branch_id = ? AND a.staff_id = ? AND a.appointment_date = ?
        AND a.status NOT IN ('Cancelled','Completed','Rejected')`;
    if (excludedAppointmentId) { query += ' AND a.appointment_id <> ?'; params.push(excludedAppointmentId); }
    query += ' GROUP BY a.appointment_id, a.appointment_time';
    const [rows] = await pool.query(query, params);
    const start = timeMinutes(time);
    const finish = start + Math.max(1, duration);
    return rows.every(a => {
        const busyStart = timeMinutes(a.appointment_time);
        return finish <= busyStart || start >= busyStart + Math.max(1, Number(a.duration_minutes) || 30);
    });
}
async function storeAppointmentServices(pool, appointmentId, serviceIds) {
    const counts=new Map();
    for(const id of serviceIds.map(Number))counts.set(id,(counts.get(id)||0)+1);
    for (const [id,quantity] of counts) {
        await pool.query(`INSERT INTO appointment_services(appointment_id,service_id,quantity) VALUES (?,?,?)
            ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)`,[appointmentId,id,quantity]);
    }
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
    const bookingUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/client/my-appointments.html`;

    const templateParams = {
        to_email: enriched.client_email,
        client_name: enriched.client_name || 'Valued Client',
        appointment_date: formattedDate,
        appointment_time: formattedTime,
        branch_address: enriched.branch_address || '',
        services: enriched.all_service_names || enriched.service_name || '',
        booking_url: bookingUrl,
        message: enriched.message || 'No additional message provided.',
        subject: 'Your Barber R Us appointment is confirmed'
    };

    const sent = await sendViaEmailJs(templateParams);

    return {
        sent,
        to_email: enriched.client_email,
        client_name: enriched.client_name,
        date: formattedDate,
        time: formattedTime,
        branch_address: enriched.branch_address,
        services: enriched.all_service_names || enriched.service_name || '',
        message: enriched.message || '',
        booking_url: bookingUrl
    };
}

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();
        await require('./_lib/auth').verifyRequestSession(req, res);

        // Data needed by the booking form.
        if (url.includes('/form-data')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const [branchesResult, servicesResult, staffResult, branchServiceResult, qualificationResult] = await Promise.all([
                pool.query('SELECT * FROM branches ORDER BY branch_id'),
                pool.query('SELECT * FROM services ORDER BY category, service_id'),
                pool.query(`
                    SELECT s.staff_id, s.branch_id, s.specialization, u.name AS staff_name, b.name AS branch_name
                    FROM staff s
                    JOIN users u ON s.user_id = u.user_id AND u.role = 'staff' AND s.is_active=1
                    JOIN branches b ON s.branch_id = b.branch_id
                    ORDER BY u.name
                `),
                pool.query('SELECT branch_id,service_id,is_active FROM branch_services'),
                pool.query('SELECT staff_id,service_id FROM staff_services')
            ]);
            return res.status(200).json({
                success: true,
                branches: branchesResult[0],
                services: servicesResult[0],
                staff: staffResult[0],
                branch_services: branchServiceResult[0],
                staff_services: qualificationResult[0]
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
                  AND status NOT IN ('Cancelled', 'Completed', 'Rejected')
            `;
            const params = [branch_id, date];
            // With no preferred barber the admin will assign a free one later;
            // a booking with another barber does not make the entire branch unavailable.
            if (!staff_id || staff_id === '0' || staff_id === 'null') {
                return res.status(200).json({ success: true, unavailable_times: [] });
            }
            query += ' AND staff_id = ?';
            params.push(staff_id);
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
            const bookingUser = requireAuth(req, res, ['client']);
            if (!bookingUser) return;
            const { branch_id, service_id, service_ids, staff_id, date, time, message, pax } = req.body || {};
            const client_id = bookingUser.id;
            const ids = normalizeServiceIds(service_ids, service_id);
            const assignedStaff = staff_id && String(staff_id) !== '0' ? Number(staff_id) : null;
            const paxCount = Number(pax ?? 1);
            if (!Number.isInteger(paxCount) || paxCount < 1 || paxCount > 20) return res.status(400).json({success:false,message:'Party size must be 1–20.'});

            if (!client_id || !branch_id || !ids.length || !isFutureSlot(date, time)) {
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
            const [allowedServices] = await pool.query(`SELECT service_id FROM branch_services WHERE branch_id=? AND is_active=1`, [branch_id]);
            const allowed=new Set(allowedServices.map(x=>String(x.service_id)));
            if (ids.some(id=>!allowed.has(String(id)))) return res.status(400).json({success:false,message:'A selected service is not offered at this branch.'});

            if (assignedStaff && !(await barberQualified(pool,assignedStaff,ids))) return res.status(409).json({ success:false,message:'This barber is not certified in all the selected services. Choose No Preference or another barber.' });
            if (assignedStaff && !(await staffBelongsToBranch(pool, assignedStaff, branch_id))) {
                return res.status(400).json({ success: false, message: 'Selected staff member does not belong to this branch.' });
            }
            if (assignedStaff && !(await isStaffTimeAvailable(pool, branch_id, assignedStaff, date, time, null, serviceValidation.serviceRows.reduce((sum,s) => sum + Number(s.duration_minutes || 30),0)))) {
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

            const cn = await pool.getConnection();
            let result;
            try {
                await cn.beginTransaction();
                if (assignedStaff) {
                    await cn.query('SELECT staff_id FROM staff WHERE staff_id=? FOR UPDATE',[assignedStaff]);
                    if (!(await isStaffTimeAvailable(cn,branch_id,assignedStaff,date,time,null,serviceValidation.serviceRows.reduce((n,s)=>n+Number(s.duration_minutes||30),0)))) {
                        await cn.rollback();
                        return res.status(409).json({success:false,message:'This barber was just booked for that time. Please select another slot.'});
                    }
                }
            const [insertResult] = await cn.query(`
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

            result = insertResult;
            await storeAppointmentServices(cn, result.insertId, ids);
            await audit(cn, req, 'appointment.created', 'appointment', result.insertId, { branch_id, staff_id: assignedStaff });
            await logBookingHistory(cn, {
                appointmentId: result.insertId,
                action: 'created',
                previousStatus: null,
                newStatus: 'Pending Payment',
                changedBy: client_id,
                details: `Booking created for ${client.name || 'client'}`
            });
                await cn.commit();
            } catch(error) { await cn.rollback(); throw error; } finally { cn.release(); }

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
            const authUser = requireAuth(req, res, ['client','admin','staff']);
            if (!authUser) return;
            if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_PAYMENTS !== 'true') {
                return res.status(403).json({ success: false, message: 'Demo confirmations are disabled. Connect a verified payment gateway before accepting payments.' });
            }
            const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
            const ids = rawIds.map(id => Number.parseInt(id, 10)).filter(Number.isFinite);
            if (!ids.length) return res.status(400).json({ success: false, message: 'No appointment IDs were supplied.' });

            const placeholders = ids.map(() => '?').join(',');
            const [beforeRows] = await pool.query(`SELECT appointment_id, client_id, branch_id, status FROM appointments WHERE appointment_id IN (${placeholders})`, ids);
            if (beforeRows.length !== ids.length) {
                return res.status(404).json({ success: false, message: 'One or more appointments were not found.' });
            }

            if (authUser.role === 'staff' && beforeRows.some(row => !isStaffScope(authUser, row.branch_id))) {
                return res.status(403).json({ success: false, message: 'Appointments belong to another branch.' });
            }
            if (authUser.role === 'client') {
                const unauthorized = beforeRows.some(row => Number(row.client_id) !== Number(authUser.id));
                if (unauthorized) {
                    return res.status(403).json({ success: false, message: 'You can only confirm your own appointments.' });
                }
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
            for (const id of newlyConfirmed) await audit(pool, req, 'appointment.demo_confirmed', 'appointment', id);
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
            const historyUser = requireAuth(req, res, ['client','admin','staff']);
            if (!historyUser) return;
            let { appointment_id, client_id } = req.query || {};
            if (historyUser.role === 'client') client_id = historyUser.id;
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
            if (historyUser.role !== 'admin') {
                let scope = 'SELECT client_id, branch_id FROM appointments WHERE appointment_id = ?';
                if (appointment_id) {
                    const [appointments] = await pool.query(scope, [appointment_id]);
                    if (!appointments.length || (historyUser.role === 'client' && Number(appointments[0].client_id) !== Number(historyUser.id)) || !isStaffScope(historyUser, appointments[0].branch_id)) {
                        return res.status(403).json({ success: false, message: 'Access denied.' });
                    }
                } else if (historyUser.role === 'staff') {
                    const [scoped] = await pool.query('SELECT a.appointment_id FROM appointments a WHERE a.client_id = ? AND a.branch_id = ?', [client_id, historyUser.branch_id]);
                    const permitted = new Set(scoped.map(a => Number(a.appointment_id)));
                    return res.status(200).json({ success: true, history: rows.filter(row => permitted.has(Number(row.appointment_id))) });
                }
            }
            return res.status(200).json({ success: true, history: rows });
        }

        // Client requests a new schedule; admin/staff can approve by changing Pending Reschedule -> Confirmed.
        if (url.includes('/request-reschedule')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const authUser = requireAuth(req, res, ['client', 'admin', 'staff']);
            if (!authUser) return;

            const { appointment_id, new_date, new_time } = req.body || {};
            if (!appointment_id || !isFutureSlot(new_date, new_time)) {
                return res.status(400).json({ success: false, message: 'appointment_id, new_date, and new_time are required.' });
            }

            const [rows] = await pool.query('SELECT branch_id, staff_id, status, client_id FROM appointments WHERE appointment_id = ? LIMIT 1', [appointment_id]);
            if (!rows.length) return res.status(404).json({ success: false, message: 'Appointment not found.' });

            if (!isStaffScope(authUser, rows[0].branch_id)) return res.status(403).json({ success: false, message: 'Wrong branch.' });
            if (authUser.role === 'client' && Number(rows[0].client_id) !== Number(authUser.id)) {
                return res.status(403).json({ success: false, message: 'You can only reschedule your own appointments.' });
            }

            if (['Cancelled','Completed','Rejected'].includes(rows[0].status)) {
                return res.status(409).json({ success: false, message: 'Completed or cancelled appointments cannot be rescheduled.' });
            }

            if (rows[0].staff_id && !(await (async()=>{
                const [durations]=await pool.query('SELECT SUM(s.duration_minutes*aps.quantity) AS minutes FROM appointment_services aps JOIN services s ON s.service_id=aps.service_id WHERE aps.appointment_id=?',[appointment_id]);
                return isStaffTimeAvailable(pool,rows[0].branch_id,rows[0].staff_id,new_date,new_time,appointment_id,Number(durations[0]?.minutes)||30);
            })())) {
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
            const authUser = requireAuth(req, res, ['admin', 'staff']);
            if (!authUser) return;
            const { appointment_id, appointment_date, appointment_time, status } = req.body || {};
            if (!appointment_id || !validDateTime(appointment_date, appointment_time) || !status || !VALID_STATUSES.includes(status) || status==='Rejected') {
                return res.status(400).json({ success: false, message: 'A valid appointment, date, time, and status are required.' });
            }

            const [existing] = await pool.query('SELECT status,branch_id,staff_id FROM appointments WHERE appointment_id = ? LIMIT 1', [appointment_id]);
            if (!existing.length) return res.status(404).json({ success: false, message: 'Appointment not found.' });
            if (!isStaffScope(authUser, existing[0].branch_id)) return res.status(403).json({ success: false, message: 'Wrong branch.' });
            if (['Completed','Cancelled','Rejected'].includes(existing[0].status)) return res.status(409).json({success:false,message:'A closed appointment cannot be reopened or rescheduled.'});
            if (authUser.role==='staff' && ['Cancelled','Rejected'].includes(status)) return res.status(403).json({success:false,message:'Only admins can reject or cancel other bookings.'});
            if (!validStatusChange(existing[0].status,status)) return res.status(409).json({success:false,message:'Invalid appointment status transition.'});
            const [selectedMinutes]=await pool.query('SELECT SUM(s.duration_minutes*aps.quantity) AS minutes FROM appointment_services aps JOIN services s ON s.service_id=aps.service_id WHERE aps.appointment_id=?',[appointment_id]);
            if (existing[0].staff_id && !(await isStaffTimeAvailable(pool, existing[0].branch_id, existing[0].staff_id, appointment_date, appointment_time, appointment_id, Number(selectedMinutes[0]?.minutes)||30))) return res.status(409).json({ success: false, message: 'Barber is not available at that time.' });

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
                changedBy: authUser.id,
                details: `Status changed from ${existing[0].status} to ${status}`
            });

            await audit(pool, req, 'appointment.updated', 'appointment', appointment_id, { status, date: appointment_date, time: appointment_time });
            if (status === 'Confirmed' && existing[0].status !== 'Confirmed') {
                await sendAppointmentEmail(pool, appointment_id);
            }

            return res.status(200).json({ success: true, message: 'Appointment updated.' });
        }

        // Admin/staff walk-in creation. Walk-ins get/reuse a client record so the existing FK remains valid.
        if (url.includes('/walkin')) {
            if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const walkAuthUser = requireAuth(req, res, ['admin', 'staff']);
            if (!walkAuthUser) return;
            const { client_name, client_email, branch_id, service_ids, staff_id, date, time, pax } = req.body || {};
            const ids = normalizeServiceIds(service_ids, null);
            const assignedStaff = staff_id ? Number(staff_id) : null;
            if (!client_name || !branch_id || !ids.length || !validDateTime(date,time)) {
                return res.status(400).json({ success: false, message: 'Client name, branch, service, date, and time are required.' });
            }

            if (!isStaffScope(walkAuthUser, branch_id)) return res.status(403).json({ success: false, message: 'Wrong branch.' });
            const serviceValidation = await validateServices(pool, ids);
            if (!serviceValidation.valid) return res.status(400).json({ success: false, message: 'One or more services are invalid.' });
            const [allowedServices] = await pool.query(`SELECT service_id FROM branch_services WHERE branch_id=? AND is_active=1`, [branch_id]);
            const allowed=new Set(allowedServices.map(x=>String(x.service_id)));
            if (ids.some(id=>!allowed.has(String(id)))) return res.status(400).json({success:false,message:'A selected service is not offered at this branch.'});
            if (assignedStaff && !(await barberQualified(pool,assignedStaff,ids))) return res.status(409).json({ success:false,message:'This barber is not certified in all the selected services. Choose No Preference or another barber.' });
            if (assignedStaff && !(await staffBelongsToBranch(pool, assignedStaff, branch_id))) {
                return res.status(400).json({ success: false, message: 'Selected staff member does not belong to this branch.' });
            }
            if (assignedStaff && !(await isStaffTimeAvailable(pool, branch_id, assignedStaff, date, time, null, serviceValidation.serviceRows.reduce((sum,s) => sum + Number(s.duration_minutes || 30),0)))) {
                return res.status(409).json({ success: false, message: 'That staff member is already booked for the selected time.' });
            }

            const cn = await pool.getConnection();
            let result;
            try {
                await cn.beginTransaction();
                if (assignedStaff) {
                    await cn.query('SELECT staff_id FROM staff WHERE staff_id=? FOR UPDATE',[assignedStaff]);
                    if (!(await isStaffTimeAvailable(cn,branch_id,assignedStaff,date,time,null,serviceValidation.serviceRows.reduce((n,s)=>n+Number(s.duration_minutes||30),0)))) {
                        await cn.rollback();
                        return res.status(409).json({success:false,message:'This barber was just booked for that time.'});
                    }
                }
            const normalizedEmail = client_email ? String(client_email).trim().toLowerCase() : null;
            let clientId = null;
            if (normalizedEmail) {
                const [existing] = await cn.query("SELECT user_id FROM users WHERE email = ? AND role='client' LIMIT 1", [normalizedEmail]);
                if (existing.length) clientId = existing[0].user_id;
            }
            if (!clientId) {
                const username = `walkin_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
                const randomHash = await bcrypt.hash(`${username}_${Math.random()}`, 10);
                const [userResult] = await cn.query(
                    'INSERT INTO users (username, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
                    [username, normalizedEmail, randomHash, 'client', String(client_name).trim()]
                );
                clientId = userResult.insertId;
                await cn.query('INSERT IGNORE INTO clients (user_id) VALUES (?)', [clientId]);
            }

            const [insertResult] = await cn.query(`
                INSERT INTO appointments (
                    client_id, branch_id, service_id, service_ids, pax, staff_id,
                    appointment_date, appointment_time, status, message, dp_paid, warts_dp, non_warts_price
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', 'Walk-in appointment', 0, 0, 0)
            `, [clientId, branch_id, ids[0], ids.join(','), Math.max(1, Math.min(20, Number.parseInt(pax, 10) || 1)), assignedStaff, date, timeToHHMMSS(time)]);

            result = insertResult;
            await storeAppointmentServices(cn, result.insertId, ids);
            await audit(cn, req, 'appointment.walkin_created', 'appointment', result.insertId, { branch_id, staff_id: assignedStaff });
            await logBookingHistory(cn, {
                appointmentId: result.insertId,
                action: 'created',
                previousStatus: null,
                newStatus: 'Confirmed',
                changedBy: walkAuthUser.id,
                details: 'Walk-in appointment created and confirmed'
            });
                await cn.commit();
            } catch(error) { await cn.rollback(); throw error; } finally { cn.release(); }

            await sendAppointmentEmail(pool, result.insertId);
            return res.status(201).json({ success: true, appointment_id: result.insertId, message: 'Walk-in appointment created.' });
        }

        // Published staff weekly timetable and daily appointment allocation.
        if (url.includes('/timetable')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false });
            const user = requireAuth(req, res, ['admin','staff']);
            if (!user) return;
            let { date, branch_id } = req.query || {};
            date = date || new Date().toISOString().slice(0,10);
            if (!validDateTime(date,'09:00')) return res.status(400).json({ success: false, message:'Invalid date.' });
            if (user.role === 'staff') branch_id = user.branch_id;
            const filters = [date];
            let clause = ' WHERE a.appointment_date = ?';
            if (branch_id) { clause += ' AND a.branch_id = ?'; filters.push(branch_id); }
            const [bookings] = await pool.query(`SELECT a.appointment_id,a.client_id,u.name AS client_name,a.branch_id,a.staff_id,a.appointment_date,a.appointment_time,a.status,a.service_ids FROM appointments a JOIN users u ON u.user_id=a.client_id ${clause} ORDER BY a.appointment_time`, filters);
            const [staff] = await pool.query(`SELECT s.staff_id,s.branch_id,u.name,s.specialization FROM staff s JOIN users u ON s.user_id=u.user_id AND u.role='staff' AND s.is_active=1 ${branch_id ? 'WHERE s.branch_id=?' : ''} ORDER BY u.name`, branch_id ? [branch_id] : []);
            const [qualifications] = await pool.query('SELECT staff_id,service_id FROM staff_services');
            const [required] = await pool.query('SELECT appointment_id,service_id FROM appointment_services WHERE appointment_id IN (SELECT appointment_id FROM appointments WHERE appointment_date=?)',[date]);
            const [shifts] = await pool.query(`SELECT v.* FROM staff_availability v JOIN staff s ON v.staff_id=s.staff_id ${branch_id ? 'WHERE s.branch_id=?' : ''} ORDER BY v.weekday,v.start_time`, branch_id ? [branch_id] : []);
            return res.status(200).json({ success:true, bookings, staff, shifts, staff_services:qualifications, appointment_services:required });
        }
        if (url.includes('/assign')) {
            if (req.method !== 'PUT') return res.status(405).json({ success:false });
            const user = requireAuth(req,res,['admin']);
            if (!user) return;
            const { appointment_id, staff_id } = req.body || {};
            if (!Number.isInteger(Number(appointment_id)) || !Number.isInteger(Number(staff_id)) || !Number(staff_id)) return res.status(400).json({ success:false,message:'Appointment and barber are required.' });
            const cn = await pool.getConnection();
            try {
                await cn.beginTransaction();
                // Serializes competing assignments for the same barber.
                const [staffRows] = await cn.query("SELECT s.staff_id,s.branch_id FROM staff s JOIN users u ON u.user_id=s.user_id AND u.role='staff' WHERE s.staff_id=? AND s.is_active=1 FOR UPDATE",[staff_id]);
                const [appts] = await cn.query("SELECT appointment_id,branch_id,staff_id,DATE_FORMAT(appointment_date,'%Y-%m-%d') AS appointment_date,appointment_time,status FROM appointments WHERE appointment_id=? FOR UPDATE",[appointment_id]);
                if (!staffRows.length || !appts.length) { await cn.rollback(); return res.status(404).json({ success:false,message:'Barber or booking not found.' }); }
                const a = appts[0];
                if (!isStaffScope(user,a.branch_id) || Number(staffRows[0].branch_id)!==Number(a.branch_id)) { await cn.rollback(); return res.status(403).json({ success:false,message:'Barber and appointment must belong to your branch.' }); }
                if (['Cancelled','Completed','Rejected'].includes(a.status)) { await cn.rollback(); return res.status(409).json({ success:false,message:'Cannot assign closed appointments.' }); }
                const requiredServices=await appointmentSkillIds(cn,appointment_id);
                if (!(await barberQualified(cn,staff_id,requiredServices))) { await cn.rollback(); return res.status(409).json({success:false,message:'This barber is not qualified for every selected service. Configure qualifications first.'}); }
                const [durations] = await cn.query('SELECT SUM(s.duration_minutes * aps.quantity) AS minutes FROM appointment_services aps JOIN services s ON s.service_id=aps.service_id WHERE aps.appointment_id=?',[appointment_id]);
                if (!(await isStaffTimeAvailable(cn,a.branch_id,staff_id,String(a.appointment_date).slice(0,10),String(a.appointment_time),a.appointment_id,Number(durations[0]?.minutes)||30))) { await cn.rollback(); return res.status(409).json({ success:false,message:'Barber is already booked or is outside their timetable.' }); }
                await cn.query('UPDATE appointments SET staff_id=? WHERE appointment_id=?',[staff_id,appointment_id]);
                await logBookingHistory(cn,{appointmentId:appointment_id,action:'staff_assigned',changedBy:user.id,details:`Barber #${staff_id} assigned`});
                await audit(cn,req,'appointment.staff_assigned','appointment',appointment_id,{staff_id,previous_staff_id:a.staff_id});
                await cn.commit();
                return res.status(200).json({ success:true,message:'Barber assigned.' });
            } catch (err) { await cn.rollback(); throw err; } finally { cn.release(); }
        }
        if (url.includes('/my')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const authUser = requireAuth(req, res, ['client', 'admin', 'staff']);
            if (!authUser) return;

            let { client_id } = req.query || {};
            if (authUser.role === 'client') {
                client_id = authUser.id;
            } else if (!client_id) {
                return res.status(400).json({ success: false, message: 'client_id is required.' });
            }

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

            return res.status(200).json({ success: true, appointments: await enrichAppointments(pool, rows.filter(a => isStaffScope(authUser, a.branch_id))) });
        }

        if (url.includes('/branch')) {
            if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
            const branchAuthUser = requireAuth(req, res, ['admin', 'staff']);
            if (!branchAuthUser) return;

            let { branch_id } = req.query || {};
            // Staff can only see their own branch's appointments
            if (branchAuthUser.role === 'staff') {
                if (!branchAuthUser.branch_id) return res.status(403).json({ success: false, message: 'No branch assigned.' });
                branch_id = branchAuthUser.branch_id;
            }

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

        // Rejection is a distinct admin-only action with a mandatory reason and audit trail.
        if (url.includes('/reject')) {
            if (req.method !== 'PUT') return res.status(405).json({success:false});
            const user=requireAuth(req,res,['admin']); if(!user)return;
            const {appointment_id, reason}=req.body||{};
            const id=Number(appointment_id),why=String(reason||'').trim();
            if(!Number.isSafeInteger(id)||id<1||why.length<5||why.length>500) return res.status(400).json({success:false,message:'Select an appointment and give a rejection reason (5–500 characters).'});
            const cn=await pool.getConnection();
            try {
                await cn.beginTransaction();
                const [rows]=await cn.query('SELECT appointment_id,status FROM appointments WHERE appointment_id=? FOR UPDATE',[id]);
                if(!rows.length){await cn.rollback();return res.status(404).json({success:false,message:'Appointment not found.'});}
                if(['Rejected','Cancelled','Completed','In-Progress'].includes(rows[0].status)) {await cn.rollback();return res.status(409).json({success:false,message:'This appointment is already closed or in progress.'});}
                await cn.query("UPDATE appointments SET status='Rejected' WHERE appointment_id=?",[id]);
                await logBookingHistory(cn,{appointmentId:id,action:'rejected',previousStatus:rows[0].status,newStatus:'Rejected',changedBy:user.id,details:why});
                await audit(cn,req,'appointment.rejected','appointment',id,{reason:why,previous:rows[0].status});
                await cn.commit();
                return res.status(200).json({success:true,message:'Appointment rejected. The reason is stored in booking history.'});
            } catch(e){await cn.rollback();throw e;} finally{cn.release();}
        }
        if (url.includes('/status')) {
            if (req.method !== 'PUT') return res.status(405).json({success:false,message:'Method not allowed'});
            const actor=requireAuth(req,res,['admin','staff','client']);if(!actor)return;
            const {appointment_id,status}=req.body||{};
            const id=Number(appointment_id);
            if(!Number.isSafeInteger(id)||id<1||!VALID_STATUSES.includes(status)||status==='Rejected')return res.status(400).json({success:false,message:'Invalid status. Use the admin Reject action for rejections.'});
            const cn=await pool.getConnection();
            try {
                await cn.beginTransaction();
                const [rows]=await cn.query('SELECT appointment_id,branch_id,client_id,status FROM appointments WHERE appointment_id=? FOR UPDATE',[id]);
                if(!rows.length){await cn.rollback();return res.status(404).json({success:false,message:'Appointment not found.'});}
                const a=rows[0];
                if(actor.role==='client'&&(status!=='Cancelled'||Number(a.client_id)!==Number(actor.id))){await cn.rollback();return res.status(403).json({success:false,message:'You can only cancel your own appointment.'});}
                if(actor.role==='staff'&&!isStaffScope(actor,a.branch_id)){await cn.rollback();return res.status(403).json({success:false,message:'Wrong branch.'});}
                if(['Completed','Cancelled','Rejected'].includes(a.status)) {await cn.rollback();return res.status(409).json({success:false,message:'Closed appointments cannot be modified.'});}
                if(!validStatusChange(a.status,status)||a.status===status){await cn.rollback();return res.status(409).json({success:false,message:`Cannot change ${a.status} to ${status}.`});}
                if(actor.role==='staff'&&status==='Cancelled'){await cn.rollback();return res.status(403).json({success:false,message:'Only admins or the client may cancel appointments.'});}
                await cn.query('UPDATE appointments SET status=? WHERE appointment_id=?',[status,id]);
                await logBookingHistory(cn,{appointmentId:id,action:'status_updated',previousStatus:a.status,newStatus:status,changedBy:actor.id});
                await audit(cn,req,'appointment.status','appointment',id,{previous:a.status,status});
                await cn.commit();
                // Email errors should not roll back a committed appointment.
                if(status==='Confirmed')try{await sendAppointmentEmail(pool,id);}catch(e){console.error('Booking confirmation email error:',e);}
                return res.status(200).json({success:true,message:`Status updated to ${status}.`});
            } catch(e){await cn.rollback();throw e;} finally{cn.release();}
        }

        return res.status(404).json({ success: false, message: 'Booking route not found' });
    } catch (err) {
        console.error('Bookings API error:', err);
        return res.status(500).json({ success: false, message: 'Bookings service unavailable.' });
    }
};
