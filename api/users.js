const bcrypt = require('bcryptjs');
const { getPool, ensureSchema } = require('./_lib/db');
const { requireAuth } = require('./_lib/auth');
const { audit } = require('./_lib/audit');

module.exports = async function handler(req, res) {
    const url = req.url || '';
    const pool = getPool();

    try {
        await ensureSchema();
        await require('./_lib/auth').verifyRequestSession(req, res);

        // Admin-only account and role management. All sessions become invalid after role changes.
        if (url.includes('/accounts')) {
            if (req.method !== 'GET') return res.status(405).json({ success:false });
            const user = requireAuth(req,res,['admin']); if (!user) return;
            const [accounts] = await pool.query(`SELECT u.user_id,u.username,u.name,u.email,u.role,u.created_at,s.branch_id,b.name AS branch_name
                FROM users u LEFT JOIN staff s ON s.user_id=u.user_id AND u.role='staff' AND s.is_active=1 LEFT JOIN branches b ON b.branch_id=s.branch_id
                ORDER BY u.user_id LIMIT 500`);
            return res.status(200).json({ success:true, accounts });
        }
        if (url.includes('/role')) {
            if (req.method !== 'PUT') return res.status(405).json({ success:false });
            const user = requireAuth(req,res,['admin']); if (!user) return;
            const { user_id, role, branch_id } = req.body || {};
            if (!Number.isSafeInteger(Number(user_id)) || !['admin','staff','client'].includes(role)) return res.status(400).json({ success:false,message:'Valid user and role required.' });
            if (Number(user.id) === Number(user_id)) return res.status(400).json({ success:false,message:'An admin cannot change their own role.' });
            if (role === 'staff' && (!Number.isSafeInteger(Number(branch_id)) || Number(branch_id) <= 0)) return res.status(400).json({ success:false,message:'Staff role requires a branch.' });
            const cn = await pool.getConnection();
            try {
                await cn.beginTransaction();
                const [accounts] = await cn.query('SELECT user_id,role FROM users WHERE user_id = ? FOR UPDATE',[user_id]);
                if (!accounts.length) { await cn.rollback(); return res.status(404).json({ success:false,message:'Account not found.' }); }
                const previous = accounts[0].role;
                if (role === 'staff') {
                    const [branches] = await cn.query('SELECT branch_id FROM branches WHERE branch_id=?',[branch_id]);
                    if (!branches.length) { await cn.rollback(); return res.status(400).json({ success:false,message:'Unknown branch.' }); }
                }
                if (previous === 'staff' && role !== 'staff') {
                    // Preserve historical appointments but deactivate staff membership.
                    // Permission checks always require the current role AND active membership.
                    await cn.query('DELETE ss FROM staff_services ss JOIN staff s ON s.staff_id=ss.staff_id WHERE s.user_id=?',[user_id]);
                    await cn.query('UPDATE staff SET is_active=0 WHERE user_id=?',[user_id]);
                }
                await cn.query('DELETE FROM admins WHERE user_id=?',[user_id]);
                await cn.query('DELETE FROM clients WHERE user_id=?',[user_id]);
                await cn.query('UPDATE users SET role=? WHERE user_id=?',[role,user_id]);
                if (role === 'admin') await cn.query('INSERT INTO admins(user_id) VALUES(?)',[user_id]);
                if (role === 'client') await cn.query('INSERT INTO clients(user_id) VALUES(?)',[user_id]);
                if (role === 'staff') {
                    if(previous!=='staff')await cn.query('DELETE ss FROM staff_services ss JOIN staff s ON s.staff_id=ss.staff_id WHERE s.user_id=?',[user_id]);
                    else await cn.query('DELETE ss FROM staff_services ss JOIN staff s ON s.staff_id=ss.staff_id WHERE s.user_id=? AND s.branch_id<>?',[user_id,branch_id]);
                    await cn.query(`INSERT INTO staff(user_id,branch_id,specialization)
                        VALUES(?,?,'General Barber') ON DUPLICATE KEY UPDATE branch_id=VALUES(branch_id),is_active=1`,[user_id,branch_id]);
                }
                await cn.query('UPDATE api_sessions SET revoked_at=NOW() WHERE user_id=?',[user_id]);
                await audit(cn,req,'user.role_changed','user',user_id,{ previous, new_role:role, branch_id: role==='staff'?branch_id:null });
                await cn.commit();
                return res.status(200).json({ success:true,message:'Role changed; previous sessions revoked.' });
            } catch(error) { await cn.rollback(); throw error; } finally { cn.release(); }
        }
        // Assign exact skills rather than guessing from a barber's free-form title.
        if(url.includes('/qualifications')) {
            const user=requireAuth(req,res,['admin']);if(!user)return;
            if(req.method==='GET'){
                const [skills]=await pool.query('SELECT staff_id,service_id FROM staff_services ORDER BY staff_id,service_id');
                const [services]=await pool.query('SELECT service_id,name,category FROM services ORDER BY category,name');
                return res.status(200).json({success:true,skills,services});
            }
            if(req.method!=='PUT')return res.status(405).json({success:false});
            const id=Number(req.body?.staff_id),services=req.body?.service_ids;
            if(!Number.isSafeInteger(id)||id<1||!Array.isArray(services)||services.length>100||services.some(v=>!Number.isSafeInteger(Number(v))||Number(v)<1))return res.status(400).json({success:false,message:'Select a barber and valid services.'});
            const ids=[...new Set(services.map(Number))];
            const cn=await pool.getConnection();
            try {
                await cn.beginTransaction();
                const [staff]=await cn.query("SELECT s.staff_id,s.branch_id FROM staff s JOIN users u ON u.user_id=s.user_id AND u.role='staff' WHERE s.staff_id=? AND s.is_active=1 FOR UPDATE",[id]);
                if(!staff.length){await cn.rollback();return res.status(404).json({success:false,message:'Active barber not found.'});}
                if(ids.length){
                    const [available]=await cn.query('SELECT service_id FROM branch_services WHERE branch_id=? AND is_active=1',[staff[0].branch_id]);
                    const valid=new Set(available.map(row=>Number(row.service_id)));
                    if(ids.some(x=>!valid.has(x))){await cn.rollback();return res.status(400).json({success:false,message:'Qualifications must be for services offered at this branch.'});}
                }
                await cn.query('DELETE FROM staff_services WHERE staff_id=?',[id]);
                for(const serviceId of ids)await cn.query('INSERT INTO staff_services(staff_id,service_id) VALUES(?,?)',[id,serviceId]);
                await audit(cn,req,'staff.qualifications_updated','staff',id,{service_ids:ids});
                await cn.commit();return res.status(200).json({success:true,message:'Barber skills saved. Changes apply to future assignments.'});
            }catch(e){await cn.rollback();throw e;}finally{cn.release();}
        }
        if (url.includes('/schedule')) {
            const user = requireAuth(req,res,['admin']); if (!user) return;
            if (req.method === 'GET') {
                const [schedules] = await pool.query(`SELECT v.*,u.name AS staff_name,s.branch_id
                  FROM staff_availability v JOIN staff s ON s.staff_id=v.staff_id JOIN users u ON u.user_id=s.user_id
                  ORDER BY u.name,v.weekday,v.start_time`);
                return res.status(200).json({ success:true,schedules });
            }
            if (req.method === 'PUT') {
                const { staff_id, weekday, start_time, end_time, is_active } = req.body || {};
                const timePattern = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
                if (!Number.isInteger(Number(staff_id)) || !Number.isInteger(Number(weekday)) || Number(weekday)<0 || Number(weekday)>6 || !timePattern.test(start_time) || !timePattern.test(end_time) || start_time>=end_time) return res.status(400).json({success:false,message:'Select barber, weekday and a valid start/end time.'});
                const [staff] = await pool.query('SELECT staff_id FROM staff WHERE staff_id=?',[staff_id]);
                if (!staff.length) return res.status(404).json({success:false,message:'Unknown barber.'});
                await pool.query(`INSERT INTO staff_availability(staff_id,weekday,start_time,end_time,is_active)
                    VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE is_active=VALUES(is_active)`,[staff_id,weekday,start_time,end_time,is_active===false?0:1]);
                await audit(pool,req,'staff.schedule_updated','staff',staff_id,{weekday,start_time,end_time,is_active:is_active!==false});
                return res.status(200).json({success:true});
            }
            return res.status(405).json({success:false});
        }
        if (url.includes('/staff')) {
            if (req.method === 'GET') {
                // Owner can see all; staff can see only their own branch
                const authUser = requireAuth(req, res, ['admin', 'staff']);
                if (!authUser) return;

                let query = `
                    SELECT u.user_id AS id, s.staff_id, u.name, u.username, u.email, u.role,
                           s.branch_id, s.specialization, b.name AS branch_name
                    FROM users u
                    JOIN staff s ON u.user_id = s.user_id
                    LEFT JOIN branches b ON s.branch_id = b.branch_id
                    WHERE u.role = 'staff' AND s.is_active = 1
                `;
                const params = [];
                if (authUser.role === 'staff' && authUser.branch_id) {
                    query += ' AND s.branch_id = ?';
                    params.push(authUser.branch_id);
                }
                query += ' ORDER BY u.name';
                const [rows] = await pool.query(query, params);
                return res.status(200).json({ success: true, staff: rows });
            }

            if (req.method === 'POST') {
                // Only owners can create staff
                const authUser = requireAuth(req, res, ['admin']);
                if (!authUser) return;

                const { name, username, email, password, branch_id, specialization } = req.body || {};
                if (!name || !username || !password || !branch_id) {
                    return res.status(400).json({ success: false, message: 'Name, username, password, and branch are required.' });
                }
                if (String(password).length < 8) {
                    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
                }

                const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
                let existingQuery = 'SELECT user_id FROM users WHERE username = ?';
                const existingParams = [String(username).trim()];
                if (normalizedEmail) {
                    existingQuery += ' OR email = ?';
                    existingParams.push(normalizedEmail);
                }
                const [existing] = await pool.query(existingQuery, existingParams);
                if (existing.length > 0) {
                    return res.status(409).json({ success: false, message: 'Username or email is already in use.' });
                }

                const connection = await pool.getConnection();
                try {
                    await connection.beginTransaction();
                    const hash = await bcrypt.hash(password, 10);
                    const [userResult] = await connection.query(
                        'INSERT INTO users (username, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)',
                        [String(username).trim(), normalizedEmail, hash, 'staff', String(name).trim()]
                    );
                    await connection.query(
                        'INSERT INTO staff (user_id, branch_id, specialization) VALUES (?, ?, ?)',
                        [userResult.insertId, branch_id, specialization || 'General Barber']
                    );
                    await audit(connection,req,'staff.created','user',userResult.insertId,{branch_id});
                    await connection.commit();
                    return res.status(201).json({ success: true, message: 'Staff created successfully.' });
                } catch (err) {
                    await connection.rollback();
                    throw err;
                } finally {
                    connection.release();
                }
            }

            return res.status(405).json({ success: false, message: 'Method not allowed' });
        }

        if (url.includes('/update')) {
            if (req.method !== 'PUT') return res.status(405).json({ success: false, message: 'Method not allowed' });
            // Staff and clients can update their own profile; owner can update any
            const authUser = requireAuth(req, res, ['admin', 'staff', 'client']);
            if (!authUser) return;

            const { user_id, name, username, email, branch_id } = req.body || {};
            const id=Number(user_id),cleanName=String(name||'').trim(),cleanUser=String(username||'').trim();
            const cleanEmail=email===undefined?undefined:email?String(email).trim().toLowerCase():null;
            if(!Number.isSafeInteger(id)||id<1||!cleanName||cleanName.length>100||/[<>]/.test(cleanName)||
                !/^[a-zA-Z0-9._-]{2,50}$/.test(cleanUser)||
                (cleanEmail!==undefined&&cleanEmail!==null&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)||cleanEmail.length>255))){
                return res.status(400).json({success:false,message:'Invalid ID, name, username or email.'});
            }
            if(authUser.role!=='admin'&&Number(authUser.id)!==id)return res.status(403).json({success:false,message:'You can only update your own profile.'});
            const changeBranch=branch_id!==undefined&&branch_id!==null&&branch_id!=='';
            if(changeBranch&&authUser.role!=='admin')return res.status(403).json({success:false,message:'Only administrators can transfer staff branches.'});
            const cn=await pool.getConnection();
            try{
                await cn.beginTransaction();
                const [accountRows]=await cn.query('SELECT user_id,role FROM users WHERE user_id=? FOR UPDATE',[id]);
                if(!accountRows.length){await cn.rollback();return res.status(404).json({success:false,message:'Account not found.'});}
                let branchChanged=false;
                if(changeBranch){
                    const bid=Number(branch_id);
                    if(accountRows[0].role!=='staff'||!Number.isSafeInteger(bid)||bid<1){await cn.rollback();return res.status(400).json({success:false,message:'Only staff accounts can be assigned branches.'});}
                    const [branches]=await cn.query('SELECT branch_id FROM branches WHERE branch_id=?',[bid]);
                    if(!branches.length){await cn.rollback();return res.status(400).json({success:false,message:'Branch not found.'});}
                    const [old]=await cn.query('SELECT branch_id FROM staff WHERE user_id=? FOR UPDATE',[id]);
                    branchChanged=old.length>0&&Number(old[0].branch_id)!==bid;
                    if(branchChanged){
                        await cn.query('DELETE ss FROM staff_services ss JOIN staff s ON s.staff_id=ss.staff_id WHERE s.user_id=?',[id]);
                        await cn.query('UPDATE staff SET branch_id=? WHERE user_id=?',[bid,id]);
                        await cn.query('UPDATE api_sessions SET revoked_at=NOW() WHERE user_id=?',[id]);
                    }
                }
                const params=[cleanName,cleanUser];
                let query='UPDATE users SET name=?,username=?';
                if(cleanEmail!==undefined){query+=',email=?';params.push(cleanEmail);}
                query+=' WHERE user_id=?';params.push(id);
                await cn.query(query,params);
                await audit(cn,req,'user.profile_updated','user',id,{branch_changed:branchChanged});
                await cn.commit();
                return res.status(200).json({success:true,message:'Profile updated successfully.'+(branchChanged?' Staff permissions and sessions refreshed.':'')});
            }catch(err){await cn.rollback();throw err;}finally{cn.release();}
        }

        return res.status(404).json({ success: false, message: 'Route not found' });
    } catch (err) {
        console.error('Users API error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Username or email is already in use.' });
        }
        return res.status(500).json({ success: false, message: 'Service unavailable.' });
    }
};
