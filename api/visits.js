'use strict';
const { getPool, ensureSchema } = require('./_lib/db');
const { verifyRequestSession, requireAuth, requestIpHash } = require('./_lib/auth');
const { audit } = require('./_lib/audit');
module.exports = async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    try {
        await ensureSchema(); await verifyRequestSession(req,res);
        const pool=getPool();
        const path=String(req.url||'').split('?')[0];
        if(path.endsWith('/attendance')){
            const user=requireAuth(req,res,['admin','staff']);if(!user)return;
            if(req.method==='GET'){
                const date=String(req.query?.date||'');
                if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
                    return res.status(400).json({success:false,message:'Select a valid calendar date.'});
                const params=[date];let branch='';
                if(user.role==='staff') {if(!user.branch_id)return res.status(403).json({success:false});branch=' AND a.branch_id=?';params.push(user.branch_id);}
                else if(req.query?.branch_id){const bid=Number(req.query.branch_id);if(!Number.isSafeInteger(bid)||bid<1)return res.status(400).json({success:false,message:'Invalid branch.'});branch=' AND a.branch_id=?';params.push(bid);}
                const [rows]=await pool.query(`SELECT a.appointment_id,a.branch_id,b.name AS branch_name,u.name AS client_name,
                  a.appointment_time,a.status,v.checked_in_at,v.checked_out_at
                  FROM appointments a JOIN branches b ON b.branch_id=a.branch_id JOIN users u ON u.user_id=a.client_id
                  LEFT JOIN appointment_visits v ON v.appointment_id=a.appointment_id
                  WHERE a.appointment_date=? ${branch} ORDER BY a.appointment_time,a.appointment_id`,params);
                return res.status(200).json({success:true,appointments:rows});
            }
            if(req.method==='PUT'){
                const id=Number(req.body?.appointment_id),action=req.body?.action;
                if(!Number.isSafeInteger(id)||id<1||!['checkin','checkout'].includes(action))return res.status(400).json({success:false,message:'Select a visit and an action.'});
                const cn=await pool.getConnection();
                try{
                    await cn.beginTransaction();
                    const [rows]=await cn.query('SELECT a.appointment_id,a.branch_id,a.status FROM appointments a WHERE a.appointment_id=? FOR UPDATE',[id]);
                    if(!rows.length){await cn.rollback();return res.status(404).json({success:false,message:'Appointment not found.'});}
                    const a=rows[0];
                    if(user.role==='staff' && Number(user.branch_id)!==Number(a.branch_id)){await cn.rollback();return res.status(403).json({success:false,message:'Wrong branch.'});}
                    if(['Cancelled','Rejected'].includes(a.status)){await cn.rollback();return res.status(409).json({success:false,message:'Cancelled/rejected bookings cannot be checked in.'});}
                    const [visits]=await cn.query('SELECT checked_in_at,checked_out_at FROM appointment_visits WHERE appointment_id=? FOR UPDATE',[id]);
                    if(action==='checkin'){
                        if(visits.length&&visits[0].checked_in_at){await cn.rollback();return res.status(409).json({success:false,message:'Customer already checked in.'});}
                        if(!['Confirmed','In-Progress','Completed'].includes(a.status)){await cn.rollback();return res.status(409).json({success:false,message:'Confirm the appointment before checking in.'});}
                        await cn.query('INSERT INTO appointment_visits(appointment_id,checked_in_at,checked_in_by) VALUES(?,NOW(),?)',[id,user.id]);
                    }else{
                        if(!visits.length||!visits[0].checked_in_at||visits[0].checked_out_at){await cn.rollback();return res.status(409).json({success:false,message:'Check in first, or this visit is already checked out.'});}
                        await cn.query('UPDATE appointment_visits SET checked_out_at=NOW(),checked_out_by=? WHERE appointment_id=?',[user.id,id]);
                    }
                    await audit(cn,req,'visit.'+action,'appointment',id,{branch_id:a.branch_id});
                    await cn.commit();return res.status(200).json({success:true,message:action==='checkin'?'Customer checked in.':'Customer checked out.'});
                }catch(e){await cn.rollback();throw e;}finally{cn.release();}
            }
            return res.status(405).json({success:false});
        }
        if(req.method!=='POST')return res.status(405).json({success:false});
        const visited=String(req.body?.path||'');
        if(!/^\/(admin|staff|client)\/[a-z-]+\.html$|^\/(index|services|branches|about-us|login|register)\.html$|^\/$/.test(visited))
            return res.status(400).json({success:false,message:'Invalid path.'});
        const hash=requestIpHash(req);
        const [prior]=await pool.query('SELECT visit_id FROM visitor_log WHERE ip_hash=? AND path=? AND visited_at > DATE_SUB(NOW(),INTERVAL 60 SECOND) LIMIT 1',[hash,visited]);
        if(!prior.length) await pool.query('INSERT INTO visitor_log(user_id,path,ip_hash,user_agent) VALUES(?,?,?,?)',[req._authUser?.id||null,visited,hash,String(req.headers?.['user-agent']||'').slice(0,240)]);
        return res.status(200).json({success:true});
    }catch(e){console.error('Visits error',e);return res.status(500).json({success:false,message:'Visits service unavailable.'});}
};
