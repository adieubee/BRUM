'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
process.env.TOKEN_SECRET='brums-feature-tests-unique-random-32-character-secret';
const users=[{user_id:1,username:'admin',name:'Admin',role:'admin',branch_id:null},
 {user_id:2,username:'client',name:'Client',role:'client',branch_id:null},
 {user_id:3,username:'staff',name:'Staff',role:'staff',branch_id:1}];
const activeSessions=new Map();
const appointments=new Map([[8,{appointment_id:8,branch_id:1,client_id:2,status:'Confirmed'}],
 [9,{appointment_id:9,branch_id:2,client_id:2,status:'Confirmed'}]]);
const visits=new Map();
const q=async(sql,params=[])=>{
  sql=String(sql);
  if(sql.includes('INSERT INTO api_sessions')) {activeSessions.set(params[0],{token_hash:params[2],role:params[3],expires_at:new Date(params[4]*1000),last_seen_at:new Date()});return [{affectedRows:1}];}
  if(sql.includes('FROM api_sessions a')){const u=users.find(x=>x.user_id===params[1]),s=activeSessions.get(params[0]);return [[...(u&&s?[{...u,role_at_login:s.role,revoked_at:null,last_seen_at:s.last_seen_at,expires_at:s.expires_at,branch_id:u.branch_id}]:[])]];}
  if(sql.includes('UPDATE api_sessions SET last_seen_at'))return [{affectedRows:1}];
  if(sql.includes('SELECT appointment_id,status FROM appointments')){const a=appointments.get(Number(params[0]));return [[...(a?[{appointment_id:a.appointment_id,status:a.status}]:[])]];}
  if(sql.includes('SELECT a.appointment_id,a.branch_id,a.status FROM appointments')){const a=appointments.get(Number(params[0]));return [[...(a?[a]:[])]];}
  if(sql.includes("UPDATE appointments SET status='Rejected'")){appointments.get(Number(params[0])).status='Rejected';return [{affectedRows:1}];}
  if(sql.includes('SELECT checked_in_at,checked_out_at FROM appointment_visits')){const row=visits.get(Number(params[0]));return [[...(row?[row]:[])]];}
  if(sql.includes('INSERT INTO appointment_visits')){visits.set(Number(params[0]),{checked_in_at:new Date(),checked_out_at:null});return [{affectedRows:1}];}
  if(sql.includes('UPDATE appointment_visits SET')){visits.get(Number(params[1])).checked_out_at=new Date();return [{affectedRows:1}];}
  if(sql.includes('INSERT INTO audit_log')||sql.includes('INSERT INTO booking_history'))return [{insertId:1,affectedRows:1}];
  throw Error('Unexpected test SQL '+sql.slice(0,140));
};
const cn={query:q,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
const pool={query:q,getConnection:async()=>cn};
const load=Module._load;
Module._load=function(name,...args){if(name==='mysql2/promise')return {createPool:()=>pool};if(name==='bcryptjs')return {hash:async()=>'',compare:async()=>false};return load.call(this,name,...args);};
const db=require('../api/_lib/db');db.getPool=()=>pool;db.ensureSchema=async()=>{};
const auth=require('../api/_lib/auth'),booking=require('../api/bookings'),visitors=require('../api/visits'),dataAdmin=require('../api/data-admin'),usersHandler=require('../api/users');
Module._load=load;
const tokens={};
async function tokenFor(u){const token=auth.createToken({id:u.user_id,role:u.role});await auth.persistSession(pool,token,{id:u.user_id,role:u.role},{headers:{}});return token;}
function req(method,url,token,body={},query={}){return {method,url,body,query,headers:token?{authorization:'Bearer '+token}:{},socket:{remoteAddress:'127.0.0.1'}};}
function res(){return {code:200,body:null,headers:{},status(x){this.code=x;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;},setHeader(k,v){this.headers[k]=v;}};}
async function call(handler,method,url,token,body,query){const r=res();await handler(req(method,url,token,body,query),r);return r;}

test('new routes reject anonymous requests and client role escalation',async()=>{
 for(const [handler,method,url] of [[booking,'PUT','/api/bookings/reject'],[visitors,'GET','/api/visits/attendance'],[dataAdmin,'GET','/api/data-admin'],[usersHandler,'PUT','/api/users/qualifications']]){
  const a=await call(handler,method,url);assert.equal(a.code,401,url+' anonymous denied');
  const client=tokens.client||=await tokenFor(users[1]);const c=await call(handler,method,url,client);assert.equal(c.code,403,url+' client denied');
 }
});
test('admin rejection mandates a reason and is terminal',async()=>{
 const admin=tokens.admin||=await tokenFor(users[0]);
 const invalid=await call(booking,'PUT','/api/bookings/reject',admin,{appointment_id:8,reason:'x'});assert.equal(invalid.code,400);
 const success=await call(booking,'PUT','/api/bookings/reject',admin,{appointment_id:8,reason:'Specialist is unavailable'});assert.equal(success.code,200);assert.equal(appointments.get(8).status,'Rejected');
 const again=await call(booking,'PUT','/api/bookings/reject',admin,{appointment_id:8,reason:'Specialist is unavailable'});assert.equal(again.code,409);
});
test('staff attendance is branch-limited and requires check-in before checkout',async()=>{
 const staff=tokens.staff||=await tokenFor(users[2]);
 let r=await call(visitors,'PUT','/api/visits/attendance',staff,{appointment_id:9,action:'checkin'});assert.equal(r.code,403);
 r=await call(visitors,'PUT','/api/visits/attendance',staff,{appointment_id:8,action:'checkin'});assert.equal(r.code,409); // rejected
 r=await call(visitors,'PUT','/api/visits/attendance',staff,{appointment_id:9,action:'checkout'});assert.equal(r.code,403);
 const admin=tokens.admin||=await tokenFor(users[0]);
 r=await call(visitors,'PUT','/api/visits/attendance',admin,{appointment_id:9,action:'checkout'});assert.equal(r.code,409);
 r=await call(visitors,'PUT','/api/visits/attendance',admin,{appointment_id:9,action:'checkin'});assert.equal(r.code,200);
 r=await call(visitors,'PUT','/api/visits/attendance',admin,{appointment_id:9,action:'checkout'});assert.equal(r.code,200);
 r=await call(visitors,'PUT','/api/visits/attendance',admin,{appointment_id:9,action:'checkout'});assert.equal(r.code,409);
});
test('admin database editor rejects arbitrary table names and invalid prices',async()=>{
 const admin=tokens.admin||=await tokenFor(users[0]);
 let r=await call(dataAdmin,'PATCH','/api/data-admin',admin,{type:'api_sessions',id:1,name:'hack'});assert.equal(r.code,400);
 r=await call(dataAdmin,'PATCH','/api/data-admin',admin,{type:'service',id:1,name:'Trim',category:'Hair',price:-1,duration_minutes:30});assert.equal(r.code,400);
});
test('staff skills require a valid staff id and an array',async()=>{
 const admin=tokens.admin||=await tokenFor(users[0]);
 let r=await call(usersHandler,'PUT','/api/users/qualifications',admin,{staff_id:1,service_ids:'all'});assert.equal(r.code,400);
 r=await call(usersHandler,'PUT','/api/users/qualifications',admin,{staff_id:1,service_ids:[-7]});assert.equal(r.code,400);
});
