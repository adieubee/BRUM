'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
process.env.TOKEN_SECRET = 'integration-test-token-secret-32-character-plus';
const fakeUsers = [{user_id:1, username:'manager', name:'Manager', role:'admin'},
                   {user_id:2, username:'customer', name:'Customer', role:'client'}];
const sessions = new Map();
const pool = {async query(sql, params=[]){
    if (sql.includes('INSERT INTO api_sessions')) {
        sessions.set(params[0],{token_hash:params[2], role:params[3], expires_at:new Date(params[4]*1000),last_seen_at:new Date()});
        return [{affectedRows:1}];
    }
    if (sql.includes('FROM api_sessions a')) {
        const u=fakeUsers.find(x=>x.user_id===params[1]), row=sessions.get(params[0]);
        return [[...(u && row ? [{...u, user_id:u.user_id, role_at_login:row.role, token_hash:row.token_hash,
            revoked_at:null, branch_id:null, expires_at:row.expires_at,last_seen_at:row.last_seen_at}] : [])]];
    }
    if (sql.includes('UPDATE api_sessions SET last_seen_at')) return [{affectedRows:1}];
    if (sql.includes('SELECT branch_id,name FROM branches')) return [[]];
    throw Error('Unmocked database query: '+sql.slice(0,85));
}};
const original = Module._load;
Module._load = function(mod,...args){
    if (mod==='mysql2/promise') return {createPool:()=>pool};
    if (mod==='bcryptjs') return {hash:async()=>'', compare:async()=>false};
    return original.call(this,mod,...args);
};
const db=require('../api/_lib/db');db.getPool=()=>pool;db.ensureSchema=async()=>{};
const auth=require('../api/_lib/auth');
const recordHandler=require('../api/records');
const serviceHandler=require('../api/services');
const userHandler=require('../api/users');
const bookingHandler=require('../api/bookings');
Module._load=original;
function req(method,url,token){return {method,url,body:{},query:{},headers:token?{authorization:'Bearer '+token}:{},socket:{remoteAddress:'127.0.0.1'}};}
function res(){return {statusCode:200,body:null,headers:{},status(x){this.statusCode=x;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;},setHeader(k,v){this.headers[k]=v;}};}
async function invoke(handler,method,url,token){const r=res();await handler(req(method,url,token),r);return r;}

test('sensitive reporting, exports, role updates, service links, and barber assignment require authorization',async()=>{
    for (const [handler,method,url] of [
        [recordHandler,'GET','/api/records/summary'],
        [recordHandler,'GET','/api/records/export'],
        [recordHandler,'GET','/api/records/snapshot'],
        [recordHandler,'GET','/api/records/audit'],
        [recordHandler,'GET','/api/records/visitors'],
        [userHandler,'GET','/api/users/accounts'],
        [userHandler,'PUT','/api/users/role'],
        [serviceHandler,'GET','/api/services/links'],
        [serviceHandler,'PUT','/api/services/links'],
        [bookingHandler,'PUT','/api/bookings/assign']
    ]){
        const r=await invoke(handler,method,url);
        assert.equal(r.statusCode,401,url+' must reject unauthenticated access');
    }
});
test('client cannot access administrative endpoints, even with a valid token',async()=>{
    const token=auth.createToken({id:2,role:'client'});
    await auth.persistSession(pool,token,{id:2,role:'client'},{headers:{}});
    for (const [handler,method,url] of [
        [recordHandler,'GET','/api/records/summary'],
        [userHandler,'GET','/api/users/accounts'],
        [serviceHandler,'GET','/api/services/links'],
        [bookingHandler,'GET','/api/bookings/timetable'],
        [bookingHandler,'PUT','/api/bookings/assign']
    ]){
        const r=await invoke(handler,method,url,token);
        assert.equal(r.statusCode,403,url+' must reject clients');
    }
});
