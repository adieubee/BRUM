'use strict';
const { getPool, ensureSchema } = require('./_lib/db');
const { verifyRequestSession, requireAuth } = require('./_lib/auth');
const { audit } = require('./_lib/audit');

module.exports = async function handler(req,res){
    const pool=getPool();
    const path=(req.url||'').split('?')[0];
    try{
        await ensureSchema();await verifyRequestSession(req,res);
        if(path.endsWith('/links')){
            const user=requireAuth(req,res,['admin']);if(!user)return;
            if(req.method==='GET'){
                const [branches,services,inventory,available,materials]=await Promise.all([
                    pool.query('SELECT branch_id,name FROM branches ORDER BY name'),
                    pool.query('SELECT service_id,name,price FROM services ORDER BY name'),
                    pool.query('SELECT inventory_id,item_name,branch_id,quantity FROM inventory ORDER BY item_name'),
                    pool.query('SELECT branch_id,service_id,is_active FROM branch_services'),
                    pool.query('SELECT service_id,inventory_id,quantity_used FROM service_inventory')
                ]);
                return res.status(200).json({success:true,branches:branches[0],services:services[0],inventory:inventory[0],branch_services:available[0],service_inventory:materials[0]});
            }
            if(req.method==='PUT'){
                const {type,branch_id,service_id,inventory_id,quantity_used,is_active}=req.body||{};
                if(!Number.isSafeInteger(Number(service_id))||Number(service_id)<=0)return res.status(400).json({success:false,message:'Select a service.'});
                const [validService]=await pool.query('SELECT service_id FROM services WHERE service_id=?',[service_id]);
                if(!validService.length)return res.status(404).json({success:false,message:'Service not found.'});
                if(type==='branch'){
                    const [validBranch]=await pool.query('SELECT branch_id FROM branches WHERE branch_id=?',[branch_id]);
                    if(!validBranch.length)return res.status(404).json({success:false,message:'Branch not found.'});
                    await pool.query(`INSERT INTO branch_services(branch_id,service_id,is_active) VALUES(?,?,?)
                        ON DUPLICATE KEY UPDATE is_active=VALUES(is_active)`,[branch_id,service_id,is_active===false?0:1]);
                    await audit(pool,req,'service.branch_updated','service',service_id,{branch_id,is_active:is_active!==false});
                    return res.status(200).json({success:true,message:'Service availability updated.'});
                }
                if(type==='inventory'){
                    const qty=Number(quantity_used);
                    const [items]=qty===0
                        ?await pool.query('SELECT inventory_id FROM inventory WHERE inventory_id=?',[inventory_id])
                        :await pool.query(`SELECT i.inventory_id FROM inventory i JOIN branch_services bs ON bs.branch_id=i.branch_id AND bs.service_id=? AND bs.is_active=1 WHERE i.inventory_id=?`,[service_id,inventory_id]);
                    if(!items.length||!Number.isSafeInteger(qty)||qty<0||qty>1000)return res.status(400).json({success:false,message:'Inventory must be from a branch offering this service; quantity must be a whole number between 0 and 1000.'});
                    if(qty===0)await pool.query('DELETE FROM service_inventory WHERE service_id=? AND inventory_id=?',[service_id,inventory_id]);
                    else await pool.query(`INSERT INTO service_inventory(service_id,inventory_id,quantity_used)
                        VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity_used=VALUES(quantity_used)`,[service_id,inventory_id,qty]);
                    await audit(pool,req,'service.inventory_link_updated','service',service_id,{inventory_id,quantity_used:qty});
                    return res.status(200).json({success:true,message:'Service-inventory relationship updated.'});
                }
                return res.status(400).json({success:false,message:'Invalid relationship type.'});
            }
            return res.status(405).json({success:false});
        }
        if(req.method!=='GET')return res.status(405).json({success:false,message:'Method not allowed.'});
        const [rows]=await pool.query('SELECT * FROM services ORDER BY category,service_id');
        return res.status(200).json({success:true,services:rows});
    }catch(err){console.error('Services API error',err);return res.status(500).json({success:false,message:'Services service unavailable.'});}
};
