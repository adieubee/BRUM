'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const { makeSlots,evaluateTime,withinBusinessHours }=require('../api/_lib/booking-availability');
const DATE='2030-10-14'; // Monday in Manila
const FUTURE=Date.parse('2029-10-14T00:00:00+08:00');
const busy=[{appointment_time:'09:00:00',duration_minutes:60}];
const schedule=[{weekday:1,start_time:'09:00:00',end_time:'18:00:00'}];
function slot(slots,time){return slots.find(x=>x.time===time);}

test('overlapping appointments lock every half-hour segment including 9:30',()=>{
 const s=makeSlots({date:DATE,duration:30,reservations:busy,shifts:schedule,staffChosen:true,now:FUTURE});
 assert.equal(slot(s,'09:00').status,'booked');
 assert.equal(slot(s,'09:30').status,'booked');
 assert.equal(slot(s,'10:00').status,'available');
});
test('long services also block slots that begin before an existing booking',()=>{
 const s=makeSlots({date:DATE,duration:90,reservations:[{appointment_time:'10:00:00',duration_minutes:30}],shifts:schedule,staffChosen:true,now:FUTURE});
 assert.equal(slot(s,'09:00').status,'booked');
 assert.equal(slot(s,'09:30').status,'booked');
 assert.equal(slot(s,'10:00').status,'booked');
 assert.equal(slot(s,'10:30').status,'available');
});
test('shift, past time, closing, and invalid input rules',()=>{
 const s=makeSlots({date:DATE,duration:60,reservations:[],shifts:[{weekday:1,start_time:'10:00:00',end_time:'12:00:00'}],staffChosen:true,now:FUTURE});
 assert.equal(slot(s,'09:00').status,'off-duty');
 assert.equal(slot(s,'10:00').status,'available');
 assert.equal(slot(s,'11:30').status,'off-duty');
 assert.equal(slot(s,'19:30').status,'closed');
 assert.equal(evaluateTime({date:DATE,time:'09:00',duration:30,staffChosen:true,now:Date.parse('2030-10-14T09:15:00+08:00')}).status,'past');
 assert.equal(withinBusinessHours('2030-10-13','17:30',60),false); // Sunday closes 18:00
 assert.equal(withinBusinessHours(DATE,'09:15',30),false); // half-hour grid only
 assert.equal(withinBusinessHours('2030-02-30','09:00',30),false);
});
test('no-preference times say request, not confirmed booking',()=>{
 const s=makeSlots({date:DATE,duration:30,reservations:busy,staffChosen:false,now:FUTURE});
 assert.equal(slot(s,'09:00').status,'request');
 assert.match(slot(s,'09:00').reason,/admin/i);
});
test('booking page preserves BRUM styles and has calendar and slot controls',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../public/client/booking.html'),'utf8');
 assert.match(src,/booking-calendar.css/);assert.match(src,/booking-calendar.js/);
 for(const id of ['bookingCalendarDays','bookingTimeSlots','bookingMonthLabel','bookingPrevMonth','bookingNextMonth','date','time','timeAvailability']) assert.match(src,new RegExp(`id="${id}"`));
 assert.doesNotMatch(src,/<input[^>]*id="time"[^>]*type="time"/);
 assert.match(src,/window\.bookingCalendar\.ensureSelected\(\)/);
});

// Exercise the server route with a stubbed DB to verify real slot status and input handling.
let handler;
const queries=[];
const fakePool={async query(sql,params){queries.push(String(sql));
 if(sql.includes('SELECT user_id, name, email FROM users')) return [[{user_id:42,name:'Test Client',email:'test@example.test'}]];
 if(sql.includes('SELECT branch_id FROM branches')) return [[{branch_id:1}]];
 if(sql.includes('FROM services')) return [[{service_id:1,name:'Haircut',price:250,duration_minutes:60}]];
 if(sql.includes('FROM branch_services')) return [[{service_id:1}]];
 if(sql.includes('FROM staff s JOIN users')) return [[{staff_id:3}]];
 if(sql.includes('FROM staff_services')) return [[{service_id:1}]];
 if(sql.includes('SELECT a.appointment_id, a.appointment_time')) return [[{appointment_time:'09:00:00',duration_minutes:60}]];
 if(sql.includes('FROM appointments a JOIN services')) return [[{appointment_time:'09:00:00',duration_minutes:60}]];
 if(sql.includes('FROM staff_availability')) return [schedule];
 throw Error('Unexpected SQL '+sql.slice(0,100));
}};
const load=Module._load;
Module._load=function(name,...args){
 if(name==='mysql2/promise')return {createPool:()=>fakePool};
 if(name==='bcryptjs') return {hash:async()=>'',compare:async()=>false};
 if(name==='./_lib/db'&&args[0]?.filename?.endsWith('/api/bookings.js')) return {getPool:()=>fakePool,ensureSchema:async()=>{}};
 if(name==='./_lib/auth'&&args[0]?.filename?.endsWith('/api/bookings.js')) return {
   verifyRequestSession:async()=>{},requireAuth:(req,res)=>req.headers?.authorization?{id:42,role:'client'}:(res.status(401).json({success:false}),null),getTokenPayload:()=>null
 };
 if(name==='./_lib/email'&&args[0]?.filename?.endsWith('/api/bookings.js')) return {generateBookingConfirmationEmail:()=>'',formatEmailDate:x=>x,formatEmailTime:x=>x,sendViaEmailJs:async()=>true};
 if(name==='./_lib/audit'&&args[0]?.filename?.endsWith('/api/bookings.js')) return {audit:async()=>{}};
 return load.call(this,name,...args);
};
handler=require('../api/bookings');
function req(query,authorized=true){return {method:'GET',url:'/api/bookings/availability',query,headers:authorized?{authorization:'Bearer test'}:{}};}
function res(){return {statusCode:200,body:null,status(x){this.statusCode=x;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};}
test('server availability marks 9 AM and 9:30 AM occupied, and 10 AM free',async()=>{
 const output=res();await handler(req({branch_id:1,date:DATE,staff_id:3,service_ids:'1'}),output);
 assert.equal(output.statusCode,200,JSON.stringify(output.body));
 assert.equal(output.body.duration_minutes,60);
 assert.equal(slot(output.body.slots,'09:00').status,'booked');
 assert.equal(slot(output.body.slots,'09:30').status,'booked');
 assert.equal(slot(output.body.slots,'10:00').status,'available');
 assert.equal(output.body.provisional,false);
 assert(queries.some(q=>q.includes('appointment_services')));
});
test('availability denies anonymous requests and invalid calendar dates',async()=>{
 const anon=res();await handler(req({branch_id:1,date:DATE,staff_id:3,service_ids:'1'},false),anon);
 assert.equal(anon.statusCode,401);
 const invalid=res();await handler(req({branch_id:1,date:'2030-02-30',staff_id:3,service_ids:'1'}),invalid);
 assert.equal(invalid.statusCode,400);
});

test('booking creation is rejected for an occupied barber before transaction begins',async()=>{
 const request={method:'POST',url:'/api/bookings/create',headers:{authorization:'Bearer test'},body:{branch_id:1,service_ids:['1'],staff_id:3,date:DATE,time:'09:30',pax:1}};
 const output=res();await handler(request,output);
 assert.equal(output.statusCode,409,JSON.stringify(output.body));
 assert.match(output.body.message,/booked|available/i);
});
