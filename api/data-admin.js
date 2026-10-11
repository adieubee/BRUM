'use strict';
// Narrow, audited, validated database editor. Never accept raw table/SQL/column inputs.
const {getPool,ensureSchema}=require('./_lib/db');
const {requireAuth,verifyRequestSession}=require('./_lib/auth');
const {audit}=require('./_lib/audit');
function text(v,max){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!/[<>]/.test(v)?v.trim():null;}
module.exports=async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    try{
        await ensureSchema();await verifyRequestSession(req,res);
        const user=requireAuth(req,res,['admin']);if(!user)return;
        const pool=getPool();
        if(req.method==='GET'){
            const [branches,services,counts]=await Promise.all([
                pool.query('SELECT branch_id,name,address FROM branches ORDER BY name LIMIT 300'),
                pool.query('SELECT service_id,name,category,price,duration_minutes FROM services ORDER BY category,name LIMIT 300'),
                pool.query(`SELECT (SELECT COUNT(*) FROM users) AS users,
                  (SELECT COUNT(*) FROM appointments) AS appointments,
                  (SELECT COUNT(*) FROM inventory) AS inventory,
                  (SELECT COUNT(*) FROM finance) AS transactions`)
            ]);
            return res.status(200).json({success:true,branches:branches[0],services:services[0],table_counts:counts[0][0]});
        }
        if(req.method!=='PATCH')return res.status(405).json({success:false});
        const {type}=req.body||{};const id=Number(req.body?.id);
        if(!Number.isSafeInteger(id)||id<1||!['branch','service'].includes(type))return res.status(400).json({success:false,message:'Invalid record.'});
        if(type==='branch'){
            const name=text(req.body.name,100),address=text(req.body.address,255);
            if(!name||!address)return res.status(400).json({success:false,message:'Enter branch name (up to 100 characters) and address (up to 255).'});
            const [result]=await pool.query('UPDATE branches SET name=?,address=? WHERE branch_id=?',[name,address,id]);
            if(!result.affectedRows)return res.status(404).json({success:false,message:'Branch not found.'});
            await audit(pool,req,'database.branch_edited','branch',id,{name,address});
        }else{
            const name=text(req.body.name,100),category=text(req.body.category,100),price=Number(req.body.price),duration=Number(req.body.duration_minutes);
            if(!name||!category||!Number.isFinite(price)||price<0||price>1000000||!Number.isSafeInteger(duration)||duration<5||duration>1440)return res.status(400).json({success:false,message:'Enter a service name/category, valid price, and a duration between 5 and 1,440 minutes.'});
            const [result]=await pool.query('UPDATE services SET name=?,category=?,price=?,duration_minutes=? WHERE service_id=?',[name,category,Math.round(price*100)/100,duration,id]);
            if(!result.affectedRows)return res.status(404).json({success:false,message:'Service not found.'});
            await audit(pool,req,'database.service_edited','service',id,{name,category,price,duration_minutes:duration});
        }
        return res.status(200).json({success:true,message:'Record saved and audit logged.'});
    }catch(err){console.error('Admin data error',err);return res.status(500).json({success:false,message:'Unable to manage data.'});}
};
