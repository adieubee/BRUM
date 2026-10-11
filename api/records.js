'use strict';
const { getPool, ensureSchema } = require('./_lib/db');
const { requireAuth, verifyRequestSession, requestIpHash } = require('./_lib/auth');
const { audit } = require('./_lib/audit');

function validDate(s) { return !s || /^\d{4}-\d{2}-\d{2}$/.test(String(s)); }
function csvEscape(value) {
    const str = value == null ? '' : String(value);
    // Protect spreadsheet users from formula injection on downloaded data.
    const safe = /^[\s]*[=+@\-]/.test(str) && !/^-?\d+(\.\d+)?$/.test(str.trim()) ? `'${str}` : str;
    return `"${safe.replace(/"/g,'""')}"`;
}
function dateFilters(query, field, params) {
    const { start_date, end_date } = query;
    if (!validDate(start_date) || !validDate(end_date)) throw Object.assign(new Error('Use YYYY-MM-DD dates.'),{status:400});
    let where = ' WHERE 1=1';
    if (start_date) { where += ` AND DATE(${field}) >= ?`; params.push(start_date); }
    if (end_date) { where += ` AND DATE(${field}) <= ?`; params.push(end_date); }
    return where;
}
module.exports = async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    try {
        await ensureSchema(); await verifyRequestSession(req,res);
        const pool = getPool();
        const user = requireAuth(req,res,['admin']); if(!user) return;
        if (req.method !== 'GET') return res.status(405).json({success:false});
        const path=(req.url||'').split('?')[0];
        const q=req.query||{};
        if (path.endsWith('/audit')) {
            const params=[]; let where=dateFilters(q,'l.created_at',params);
            if (q.search) { where+=' AND (l.event LIKE ? OR l.entity_type LIKE ? OR u.username LIKE ?)'; const term=`%${String(q.search).slice(0,80)}%`; params.push(term,term,term); }
            const page=Math.max(1,Math.min(10000,parseInt(q.page,10)||1));
            const [rows]=await pool.query(`SELECT l.audit_id,l.created_at,l.event,l.entity_type,l.entity_id,l.details,u.username AS actor FROM audit_log l LEFT JOIN users u ON u.user_id=l.actor_user_id ${where} ORDER BY l.audit_id DESC LIMIT 100 OFFSET ?`,[...params,(page-1)*100]);
            return res.status(200).json({success:true,events:rows,page});
        }
        if (path.endsWith('/visitors')) {
            const params=[];let where=dateFilters(q,'v.visited_at',params);
            if(q.search){where+=' AND (v.path LIKE ? OR u.username LIKE ?)';const term=`%${String(q.search).slice(0,80)}%`; params.push(term,term);}
            const [rows]=await pool.query(`SELECT v.visit_id,v.path,v.visited_at,LEFT(v.ip_hash,12) AS anonymous_visitor,u.username FROM visitor_log v LEFT JOIN users u ON u.user_id=v.user_id ${where} ORDER BY v.visit_id DESC LIMIT 300`,params);
            const [summary]=await pool.query('SELECT COUNT(*) AS page_views,COUNT(DISTINCT ip_hash) AS approximate_unique_visitors FROM visitor_log WHERE visited_at >= DATE_SUB(NOW(),INTERVAL 30 DAY)');
            return res.status(200).json({success:true,visits:rows,summary:summary[0]});
        }
        if (path.endsWith('/snapshot')) {
            const [branches,services,inventory,appointments,transactions,staff,branchServices,serviceInventory,appointmentServices,staffServices,visits] = await Promise.all([
                pool.query('SELECT * FROM branches'),pool.query('SELECT * FROM services'),
                pool.query('SELECT * FROM inventory'),
                pool.query(`SELECT appointment_id,client_id,branch_id,service_id,service_ids,staff_id,appointment_date,appointment_time,status,pax,created_at FROM appointments`),
                pool.query('SELECT transaction_id,appointment_id,branch_id,staff_user_id,amount,amount_due,payment_method,created_at FROM finance'),
                pool.query('SELECT staff_id,user_id,branch_id,specialization FROM staff'),
                pool.query('SELECT branch_id,service_id,is_active FROM branch_services'),
                pool.query('SELECT service_id,inventory_id,quantity_used FROM service_inventory'),
                pool.query('SELECT appointment_id,service_id,quantity FROM appointment_services'),
                pool.query('SELECT staff_id,service_id FROM staff_services'),
                pool.query('SELECT appointment_id,checked_in_at,checked_out_at FROM appointment_visits')
            ]);
            await audit(pool,req,'data.snapshot_exported');
            res.setHeader('Content-Type','application/json; charset=utf-8');
            res.setHeader('Content-Disposition','attachment; filename="brums-api-data-snapshot.json"');
            return res.status(200).send(JSON.stringify({exported_at:new Date().toISOString(),schema_version:'2.1',branches:branches[0],services:services[0],inventory:inventory[0],appointments:appointments[0],transactions:transactions[0],staff:staff[0],branch_services:branchServices[0],service_inventory:serviceInventory[0],appointment_services:appointmentServices[0],staff_services:staffServices[0],appointment_visits:visits[0]}));
        }
        // Management questions: demand, appointment outcomes, popular services/hours and check-ins.
        if(path.endsWith('/insights')) {
            const params=[];let where=dateFilters(q,'a.appointment_date',params);
            if(q.start_date&&q.end_date&&q.start_date>q.end_date)return res.status(400).json({success:false,message:'From date must be before To date.'});
            if(q.branch_id&&q.branch_id!=='all'){
                const bid=Number(q.branch_id);
                if(!Number.isSafeInteger(bid)||bid<1)return res.status(400).json({success:false,message:'Invalid branch.'});
                where+=' AND a.branch_id=?';params.push(bid);
            }
            const [outcomes]=await pool.query(`SELECT a.status,COUNT(*) AS total FROM appointments a ${where} GROUP BY a.status`,params);
            const [topServices]=await pool.query(`SELECT s.service_id,s.name,SUM(aps.quantity) AS bookings
                FROM appointments a JOIN appointment_services aps ON aps.appointment_id=a.appointment_id
                JOIN services s ON s.service_id=aps.service_id ${where} AND a.status NOT IN ('Cancelled','Rejected')
                GROUP BY s.service_id,s.name ORDER BY bookings DESC,s.name LIMIT 7`,params);
            const [busyHours]=await pool.query(`SELECT HOUR(a.appointment_time) AS hour,COUNT(*) AS appointments
                FROM appointments a ${where} AND a.status NOT IN ('Cancelled','Rejected') GROUP BY HOUR(a.appointment_time)
                ORDER BY appointments DESC,hour LIMIT 5`,params);
            const [busiestBranches]=await pool.query(`SELECT b.branch_id,b.name,COUNT(*) AS bookings
                FROM appointments a JOIN branches b ON b.branch_id=a.branch_id ${where}
                GROUP BY b.branch_id,b.name ORDER BY bookings DESC,b.name LIMIT 10`,params);
            const [attendance]=await pool.query(`SELECT COUNT(v.checked_in_at) AS checkins,COUNT(v.checked_out_at) AS checkouts
                FROM appointments a LEFT JOIN appointment_visits v ON v.appointment_id=a.appointment_id ${where}`,params);
            const total=outcomes.reduce((n,r)=>n+Number(r.total),0);
            const statusCount=Object.fromEntries(outcomes.map(r=>[r.status,Number(r.total)]));
            return res.status(200).json({success:true,filters:{start_date:q.start_date||null,end_date:q.end_date||null,branch_id:q.branch_id||'all'},total_bookings:total,status_counts:statusCount,top_services:topServices,busiest_hours:busyHours,busiest_branches:busiestBranches,attendance:attendance[0],note:'Appointment metrics reflect current statuses and scheduled appointment dates. Sales revenue uses transaction dates. Search text applies to the sales table only.'});
        }
        if (path.endsWith('/summary') || path.endsWith('/export')) {
            const params=[];let where=dateFilters(q,'f.created_at',params);
            if(q.branch_id && q.branch_id!=='all') { if(!/^\d+$/.test(String(q.branch_id))) return res.status(400).json({success:false,message:'Invalid branch.'}); where+=' AND f.branch_id=?'; params.push(q.branch_id); }
            if(q.search) {where+=' AND (b.name LIKE ? OR u.name LIKE ?)';const term=`%${String(q.search).slice(0,80)}%`;params.push(term,term);}
            const [transactions]=await pool.query(`SELECT f.transaction_id,f.created_at,f.appointment_id,f.branch_id,b.name AS branch_name,u.name AS staff_name,f.amount,f.amount_due,f.payment_method
                FROM finance f LEFT JOIN branches b ON b.branch_id=f.branch_id LEFT JOIN users u ON u.user_id=f.staff_user_id ${where} ORDER BY f.created_at DESC LIMIT 10001`,params);
            if (transactions.length > 10000) return res.status(413).json({success:false,message:'More than 10,000 transactions match. Narrow the date or branch filter for accurate complete totals and exports.'});
            const [branches]=await pool.query('SELECT branch_id,name FROM branches ORDER BY name');
            const perBranch=new Map(branches.map(b=>[Number(b.branch_id),{branch_id:b.branch_id,branch_name:b.name,transactions:0,revenue:0,cancelled:0,average_ticket:0}]));
            transactions.forEach(t=>{const r=perBranch.get(Number(t.branch_id));if(r){r.transactions++;r.revenue+=Number(t.amount)||0;}});
            const apptParams=[];let apptWhere=dateFilters(q,'a.appointment_date',apptParams);
            if(q.branch_id && q.branch_id!=='all'){apptWhere+=' AND a.branch_id=?';apptParams.push(q.branch_id);}
            // Apply the text search to cancelled appointments too; otherwise the totals mix filtered sales with unfiltered cancellations.
            let cancelledJoin='';
            if (q.search) {
                cancelledJoin=' LEFT JOIN branches b ON b.branch_id=a.branch_id LEFT JOIN staff st ON st.staff_id=a.staff_id LEFT JOIN users u ON u.user_id=st.user_id';
                apptWhere+=' AND (b.name LIKE ? OR u.name LIKE ?)';
                const term=`%${String(q.search).slice(0,80)}%`;
                apptParams.push(term,term);
            }
            const [cancelled]=await pool.query(`SELECT a.branch_id,COUNT(*) AS cnt FROM appointments a ${cancelledJoin} ${apptWhere} AND a.status='Cancelled' GROUP BY a.branch_id`,apptParams);
            cancelled.forEach(c=>{const r=perBranch.get(Number(c.branch_id)); if(r)r.cancelled=Number(c.cnt);});
            const rows=[...perBranch.values()].filter(r=>!q.branch_id||q.branch_id==='all'||Number(q.branch_id)===Number(r.branch_id)).filter(r=>!q.search||r.transactions>0||r.cancelled>0);
            rows.forEach(r=>{r.revenue=Number(r.revenue.toFixed(2));r.average_ticket=r.transactions?Number((r.revenue/r.transactions).toFixed(2)):0;});
            const totals=rows.reduce((a,r)=>({transactions:a.transactions+r.transactions,revenue:a.revenue+r.revenue,cancelled:a.cancelled+r.cancelled}),{transactions:0,revenue:0,cancelled:0});
            totals.average_ticket=totals.transactions?Number((totals.revenue/totals.transactions).toFixed(2)):0;
            if(path.endsWith('/export')){
                const format=q.format==='json'?'json':'csv';
                await audit(pool,req,'report.exported','report',format,{start_date:q.start_date||null,end_date:q.end_date||null,branch_id:q.branch_id||null});
                res.setHeader('Content-Disposition',`attachment; filename="brums-report.${format}"`);
                if(format==='json'){res.setHeader('Content-Type','application/json; charset=utf-8');return res.status(200).send(JSON.stringify({filters:q,totals,branches:rows,transactions}));}
                res.setHeader('Content-Type','text/csv; charset=utf-8');
                const fields=['transaction_id','created_at','branch_name','staff_name','appointment_id','amount','amount_due','payment_method'];
                const lines=[fields.join(','),...transactions.map(t=>fields.map(f=>csvEscape(t[f])).join(','))];
                lines.push('');lines.push('BRANCH SUMMARY');lines.push('Branch,Transactions,Cancelled,Revenue,Average Ticket');
                for(const r of rows)lines.push([r.branch_name,r.transactions,r.cancelled,r.revenue,r.average_ticket].map(csvEscape).join(','));
                lines.push(['TOTAL',totals.transactions,totals.cancelled,totals.revenue,totals.average_ticket].map(csvEscape).join(','));
                return res.status(200).send('\uFEFF'+lines.join('\r\n'));
            }
            return res.status(200).json({success:true,totals,branches:rows,transactions:transactions.slice(0,250),note:'Totals include all matched POS transactions; detailed view shows up to 250 rows.'});
        }
        return res.status(404).json({success:false,message:'Unknown report route.'});
    } catch(err){console.error('Records error:',err);return res.status(err.status||500).json({success:false,message:err.status?err.message:'Reporting service unavailable.'});}
};
