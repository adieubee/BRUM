'use strict';
let dbAccounts=[],dbBranches=[],dbServices=[];
const el=id=>document.getElementById(id),dbMessage=msg=>el('dbMessage').textContent=msg||'';
function option(sel,id,label){const o=document.createElement('option');o.value=id;o.textContent=label;sel.append(o);}
function loadSelection(){
 const u=dbAccounts.find(x=>String(x.user_id)===el('dbUser').value);if(u){el('dbUserName').value=u.name;el('dbUsername').value=u.username;el('dbEmail').value=u.email||'';}
 const b=dbBranches.find(x=>String(x.branch_id)===el('dbBranch').value);if(b){el('dbBranchName').value=b.name;el('dbBranchAddress').value=b.address;}
 const s=dbServices.find(x=>String(x.service_id)===el('dbService').value);if(s){el('dbServiceName').value=s.name;el('dbCategory').value=s.category;el('dbPrice').value=s.price;el('dbDuration').value=s.duration_minutes;}
}
async function reloadDatabase(){
 const [r,a]=await Promise.all([Auth.apiFetch('/api/data-admin'),Auth.apiFetch('/api/users/accounts')]);if(!r||!a)return;
 const data=await r.json(),users=await a.json();if(!data.success||!users.success)throw Error(data.message||users.message);
 dbAccounts=users.accounts||[];dbBranches=data.branches||[];dbServices=data.services||[];
 for(const [id,rows,key,label] of [['dbUser',dbAccounts,'user_id','username'],['dbBranch',dbBranches,'branch_id','name'],['dbService',dbServices,'service_id','name']]){
  const sel=el(id),old=sel.value;sel.replaceChildren();for(const row of rows)option(sel,row[key],row[label]);if(rows.some(x=>String(x[key])===old))sel.value=old;
 }
 const stats=el('tableStats');stats.replaceChildren();for(const [name,count] of Object.entries(data.table_counts||{})){const node=document.createElement('span');node.textContent=`${name}: ${count}`;stats.append(node);}
 loadSelection();
}
async function save(url,method,payload){const r=await Auth.apiFetch(url,{method,body:JSON.stringify(payload)});if(!r)return;const data=await r.json();dbMessage(data.message||'');if(data.success)await reloadDatabase();}
async function snapshot(){const r=await Auth.apiFetch('/api/records/snapshot');if(!r||!r.ok)throw Error('Snapshot download failed.');
 const uri=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=uri;a.download='brums-api-local-copy-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(uri),2000);}
document.addEventListener('DOMContentLoaded',async()=>{
 const me=await Auth.me();if(!me||me.role!=='admin'){Auth.logout('expired');return;}
 try{await reloadDatabase();}catch(e){dbMessage(e.message);}
 for(const id of ['dbUser','dbBranch','dbService'])el(id).addEventListener('change',loadSelection);
 el('userForm').onsubmit=e=>{e.preventDefault();save('/api/users/update','PUT',{user_id:Number(el('dbUser').value),name:el('dbUserName').value,username:el('dbUsername').value,email:el('dbEmail').value}).catch(x=>dbMessage(x.message));};
 el('branchForm').onsubmit=e=>{e.preventDefault();save('/api/data-admin','PATCH',{type:'branch',id:Number(el('dbBranch').value),name:el('dbBranchName').value,address:el('dbBranchAddress').value}).catch(x=>dbMessage(x.message));};
 el('serviceForm').onsubmit=e=>{e.preventDefault();save('/api/data-admin','PATCH',{type:'service',id:Number(el('dbService').value),name:el('dbServiceName').value,category:el('dbCategory').value,price:Number(el('dbPrice').value),duration_minutes:Number(el('dbDuration').value)}).catch(x=>dbMessage(x.message));};
 el('exportLocal').onclick=()=>snapshot().catch(e=>dbMessage(e.message));
 el('localFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>20*1024*1024)throw Error('Local JSON preview is limited to 20 MB.');const data=JSON.parse(await f.text());if(!data.exported_at||!Array.isArray(data.appointments))throw Error('File is not a BRUM API snapshot.');
  el('localSummary').textContent=`Local read-only snapshot from ${data.exported_at}: ${data.branches?.length||0} branches, ${data.services?.length||0} services, ${data.appointments.length} appointments, ${data.transactions?.length||0} sales. Not uploaded to server.`;
 }catch(err){dbMessage(err.message);}};
});
