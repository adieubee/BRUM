const phDate=s=>new Date(s).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'});
const msg=text=>document.getElementById('opMessage').textContent=text;
const cell=(row,value)=>{const td=document.createElement('td');td.textContent=String(value??'');row.append(td);return td;};
let auditPage=1, userId=0,allAccounts=[],allBranches=[];
function openTab(name){for(const pane of document.querySelectorAll('.tab-pane'))pane.classList.toggle('active',pane.id===name);({audit:loadAudit,visitors:loadVisits,accounts:loadAccounts})[name]().catch(e=>msg(e.message));}
const paramsOf=section=>{const p=new URLSearchParams();for(const [key,suffix] of [['start_date','Start'],['end_date','End'],['search','Search']]){const val=document.getElementById(section+suffix).value.trim();if(val)p.set(key,val);}return p;};
async function loadAudit(){const p=paramsOf('audit');p.set('page',auditPage);const r=await Auth.apiFetch('/api/records/audit?'+p);if(!r)return;const data=await r.json();if(!data.success){msg(data.message);return;}const tbody=document.getElementById('auditRows');tbody.replaceChildren();for(const e of data.events){const tr=document.createElement('tr');for(const val of [phDate(e.created_at),e.actor||'System',e.event,[e.entity_type,e.entity_id].filter(Boolean).join(' #'),JSON.stringify(e.details||{})])cell(tr,val);tbody.append(tr);}msg(`Showing page ${auditPage} (${data.events.length} events).`);}
async function loadVisits(){const r=await Auth.apiFetch('/api/records/visitors?'+paramsOf('visitors'));if(!r)return;const d=await r.json();if(!d.success){msg(d.message);return;}document.getElementById('visitorSummary').textContent=`Last 30 days: ${d.summary.page_views} page views; ${d.summary.approximate_unique_visitors} approximate unique visitors (IP-hash based; not unique people).`;const tbody=document.getElementById('visitorsRows');tbody.replaceChildren();for(const v of d.visits){const tr=document.createElement('tr');for(const val of [phDate(v.visited_at),v.path,v.username||'Anonymous',v.anonymous_visitor])cell(tr,val);tbody.append(tr);}}
async function loadAccounts(){const r=await Auth.apiFetch('/api/users/accounts');if(!r)return;const d=await r.json();if(!d.success){msg(d.message);return;}allAccounts=d.accounts;renderAccounts();}
function renderAccounts(){const term=document.getElementById('accountSearch').value.toLowerCase();const tbody=document.getElementById('accountRows');tbody.replaceChildren();for(const a of allAccounts.filter(a=>[a.name,a.username,a.email].some(v=>String(v||'').toLowerCase().includes(term)))){
    const tr=document.createElement('tr');cell(tr,`${a.name} (${a.username})`);cell(tr,a.role);cell(tr,a.branch_name||'—');
    const roleTd=document.createElement('td'),role=document.createElement('select');for(const v of ['client','staff','admin']){const o=document.createElement('option');o.value=v;o.textContent=v;role.append(o);}role.value=a.role;roleTd.append(role);tr.append(roleTd);
    const branchTd=document.createElement('td'),branch=document.createElement('select');const blank=document.createElement('option');blank.value='';blank.textContent='Select branch';branch.append(blank);for(const b of allBranches){const o=document.createElement('option');o.value=b.branch_id;o.textContent=b.name;branch.append(o);}branch.value=a.branch_id||'';branchTd.append(branch);tr.append(branchTd);
    const action=document.createElement('td'),button=document.createElement('button');button.textContent=a.user_id===userId?'Current account':'Update role';button.disabled=a.user_id===userId;
    button.onclick=async()=>{if(!confirm(`Set ${a.username}'s role to ${role.value}? Their sessions will be revoked.`))return;const r=await Auth.apiFetch('/api/users/role',{method:'PUT',body:JSON.stringify({user_id:a.user_id,role:role.value,branch_id:branch.value||null})});if(!r)return;const d=await r.json();msg(d.message||'Updated');if(d.success)loadAccounts();};action.append(button);tr.append(action);tbody.append(tr);
}}
document.addEventListener('DOMContentLoaded',async()=>{
    const me=await Auth.me();if(!me||me.role!=='admin'){Auth.logout('expired');return;}userId=me.id;
    const r=await Auth.apiFetch('/api/branches');if(r?.ok){const d=await r.json();allBranches=d.branches||[];}
    document.getElementById('auditFilters').onsubmit=e=>{e.preventDefault();auditPage=1;loadAudit();};
    document.getElementById('visitorFilters').onsubmit=e=>{e.preventDefault();loadVisits();};
    document.getElementById('accountSearch').oninput=renderAccounts;
    await loadAudit();
});
