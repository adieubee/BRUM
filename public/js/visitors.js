'use strict';
const $v=id=>document.getElementById(id),phTime=s=>s?new Date(s).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';
const tcell=(tr,content)=>{const td=document.createElement('td');td.textContent=String(content??'');tr.append(td);return td;};
const visitNote=s=>$v('visitMessage').textContent=s||'';
async function attendance(){
  const p=new URLSearchParams({date:$v('visitDate').value});if($v('visitBranch').value)p.set('branch_id',$v('visitBranch').value);
  const r=await Auth.apiFetch('/api/visits/attendance?'+p);if(!r)return;
  const data=await r.json();if(!data.success)throw Error(data.message||'Unable to fetch visits.');
  const tbody=$v('attendanceRows');tbody.replaceChildren();
  for(const a of data.appointments){
    const tr=document.createElement('tr');
    for(const val of ['#'+a.appointment_id,a.client_name,a.branch_name,String(a.appointment_time).slice(0,5),a.status,phTime(a.checked_in_at),phTime(a.checked_out_at)])tcell(tr,val);
    const td=document.createElement('td');
    if(!['Cancelled','Rejected'].includes(a.status)){
      const btn=document.createElement('button');btn.type='button';btn.textContent=a.checked_in_at?'Check out':'Check in';
      btn.disabled=Boolean(a.checked_out_at)||(!a.checked_in_at&&!['Confirmed','In-Progress','Completed'].includes(a.status));
      btn.onclick=async()=>{
        btn.disabled=true;
        try{const response=await Auth.apiFetch('/api/visits/attendance',{method:'PUT',body:JSON.stringify({appointment_id:a.appointment_id,action:a.checked_in_at?'checkout':'checkin'})});if(!response)return;const result=await response.json();visitNote(result.message);if(result.success)await attendance();else btn.disabled=false;}
        catch(e){visitNote(e.message);btn.disabled=false;}
      };td.append(btn);
    }tr.append(td);tbody.append(tr);
  }
  $v('attendanceSummary').textContent=`${data.appointments.length} appointments · ${data.appointments.filter(x=>x.checked_in_at).length} checked in · ${data.appointments.filter(x=>x.checked_out_at).length} checked out`;
}
async function visitors(){
  const p=new URLSearchParams();for(const [key,id] of [['start_date','webStart'],['end_date','webEnd'],['search','webSearch']]){if($v(id).value)p.set(key,$v(id).value);}
  const r=await Auth.apiFetch('/api/records/visitors?'+p);if(!r)return;
  const data=await r.json();if(!data.success)throw Error(data.message||'Unable to fetch visitor logs.');
  $v('webSummary').textContent=`Past 30 days: ${data.summary.page_views} page views, ~${data.summary.approximate_unique_visitors} unique IP hashes (not unique people).`;
  const tbody=$v('webRows');tbody.replaceChildren();for(const a of data.visits){const tr=document.createElement('tr');for(const val of [phTime(a.visited_at),a.path,a.username||'Anonymous',a.anonymous_visitor])tcell(tr,val);tbody.append(tr);}
}
document.addEventListener('DOMContentLoaded',async()=>{
  const me=await Auth.me();if(!me||me.role!=='admin'){Auth.logout('expired');return;}
  const now=new Date();const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
  const parts=Object.fromEntries(formatter.formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));$v('visitDate').value=`${parts.year}-${parts.month}-${parts.day}`;
  const b=await Auth.apiFetch('/api/branches');if(b?.ok){const data=await b.json();for(const branch of data.branches||[]){const op=document.createElement('option');op.value=branch.branch_id;op.textContent=branch.name;$v('visitBranch').append(op);}}
  $v('attendanceFilters').onsubmit=e=>{e.preventDefault();attendance().catch(ex=>visitNote(ex.message));};
  $v('webFilters').onsubmit=e=>{e.preventDefault();visitors().catch(ex=>visitNote(ex.message));};
  await Promise.all([attendance(),visitors()]).catch(e=>visitNote(e.message));
});
