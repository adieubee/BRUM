'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
process.env.TOKEN_SECRET='test-only-secret-never-use-in-real-app-123456789';
const fakeUsers=[{user_id:1,username:'admin',role:'admin',name:'Site Admin',password_hash:'fake',email:'admin@example.test'},
                 {user_id:2,username:'guest',role:'client',name:'Sample Client',password_hash:'fake',email:'guest@example.test'}];
const fakeSessions=new Map();
const fakeLock=new Map();
const now=()=>new Date();
const pool={async query(sql,params=[]){
    sql=String(sql);
    if(sql.includes('FROM login_attempts')){const row=fakeLock.get(params[0]);return [[...(row?[row]:[])]];}
    if(sql.includes('INSERT INTO login_attempts')){const key=params[0],old=fakeLock.get(key)||{failed_count:0};const failed_count=old.failed_count+1;fakeLock.set(key,{failed_count,locked_until:failed_count>=3?new Date(Date.now()+15*60*1000):null});return [{affectedRows:1}];}
    if(sql.includes('DELETE FROM login_attempts')){fakeLock.delete(params[0]);return [{affectedRows:1}];}
    if(sql.includes('SELECT user_id, username, email, password_hash'))return [fakeUsers.filter(u=>u.username===params[0]||u.email===params[1])];
    if(sql.includes('SELECT u.user_id') && sql.includes('FROM api_sessions')){
        const session=fakeSessions.get(params[0]);const u=fakeUsers.find(x=>x.user_id===params[1]);
        if(!session||!u||session.token_hash!==params[2])return [[]];
        return [[{user_id:u.user_id,username:u.username,role:u.role,name:u.name,branch_id:null,session_id:params[0],role_at_login:session.role,revoked_at:session.revoked_at,last_seen_at:session.last_seen_at,expires_at:session.expires_at}]];
    }
    if(sql.includes('INSERT INTO api_sessions')){
        fakeSessions.set(params[0],{token_hash:params[2],role:params[3],expires_at:new Date(params[4]*1000),last_seen_at:now(),revoked_at:null});return [{affectedRows:1}];
    }
    if(sql.includes('UPDATE api_sessions SET last_seen_at')){fakeSessions.get(params[0]).last_seen_at=now();return [{affectedRows:1}];}
    if(sql.includes('UPDATE api_sessions SET revoked_at')){fakeSessions.get(params[0]).revoked_at=now();return [{affectedRows:1}];}
    if(sql.includes('INSERT INTO audit_log'))return [{insertId:1}];
    if(sql.includes('SELECT') && sql.includes('FROM staff'))return [[]];
    throw new Error('Unhandled test SQL '+sql.slice(0,100));
}};
const originalLoad=Module._load;
Module._load=function(name,...args){
    if(name==='mysql2/promise')return {createPool:()=>pool};
    if(name==='bcryptjs')return {compare:async(pass)=>pass==='correct-password',hash:async()=> 'fake'};
    return originalLoad.call(this,name,...args);
};
const db=require('../api/_lib/db');db.getPool=()=>pool;db.ensureSchema=async()=>{};
const auth=require('../api/_lib/auth');
const authHandler=require('../api/auth');
const bookingHandler=require('../api/bookings');
const inventoryHandler=require('../api/inventory');
Module._load=originalLoad;
function request(method,url,body,token){return {method,url,body:body||{},query:{},headers:token?{authorization:'Bearer '+token}:{},socket:{remoteAddress:'127.0.0.1'}};}
function response(){return {statusCode:200,body:null,headers:{},status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;},setHeader(k,v){this.headers[k]=v;}};}

test('invalid credentials are locked after three failed logins',async()=>{
    const req=()=>request('POST','/api/auth/login',{username:'unknown-user',password:'bad'});
    for(let i=0;i<3;i++){const r=response();await authHandler(req(),r);assert.equal(r.statusCode,401);}
    const locked=response();await authHandler(req(),locked);
    assert.equal(locked.statusCode,429);assert.equal(locked.body.success,false);
});
test('login tokens are session-backed, role changes reject stale permissions',async()=>{
    const r=response();await authHandler(request('POST','/api/auth/login',{username:'guest',password:'correct-password'}),r);
    assert.equal(r.statusCode,200);assert.equal(r.body.user.role,'client');
    const token=r.body.token;
    const goodReq=request('GET','/api/auth/me',null,token);const me=response();await authHandler(goodReq,me);
    assert.equal(me.statusCode,200);assert.equal(me.body.user.role,'client');
    const protectedReq=request('POST','/api/bookings/create',{},token);
    const badForm=response();await bookingHandler(protectedReq,badForm);assert.equal(badForm.statusCode,400); // validated client but missing fields
    fakeUsers[1].role='admin'; // simulates role change before old token expires
    const stale=response();await authHandler(request('GET','/api/auth/me',{},token),stale);
    assert.equal(stale.statusCode,401);
    fakeUsers[1].role='client';
});
test('anonymous cannot create appointments, fake-confirm, read history or see inventory',async()=>{
    for(const [handler,method,url] of [[bookingHandler,'POST','/api/bookings/create'],[bookingHandler,'POST','/api/bookings/payment-success'],[bookingHandler,'GET','/api/bookings/history'],[inventoryHandler,'GET','/api/inventory']]){
        const r=response();await handler(request(method,url,{client_id:2,branch_id:1,date:'2026-10-12',time:'10:00',service_id:1}),r);
        assert.equal(r.statusCode,401,`${url} must require auth`);
    }
});
test('session idle expiration invalidates token before 12-hour absolute expiry',async()=>{
    const r=response();await authHandler(request('POST','/api/auth/login',{username:'admin',password:'correct-password'}),r);
    assert.equal(r.statusCode,200);
    const payload=r.body.token.split('.')[0];const sid=JSON.parse(Buffer.from(payload,'base64url').toString()).sid;
    fakeSessions.get(sid).last_seen_at=new Date(Date.now()-21*60*1000);
    const expired=response();await authHandler(request('GET','/api/auth/me',null,r.body.token),expired);
    assert.equal(expired.statusCode,401);
});
