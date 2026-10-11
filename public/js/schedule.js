let scheduleUser=null, branches=[],barbers=[];
const setText=(id,val)=>document.getElementById(id).textContent=String(val??'');
const addCell=(tr,val)=>{const td=document.createElement('td');td.textContent=String(val??'');tr.append(td);return td;};
const phDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
const ymd=()=>{const parts=Object.fromEntries(phDay.formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
async function loadSchedule(){
    const p=new URLSearchParams({date:document.getElementById('workDate').value});
    const branch=document.getElementById('branchChoice').value;
    if(branch)p.set('branch_id',branch);
    const r=await Auth.apiFetch('/api/bookings/timetable?'+p);
    if(!r)return;const d=await r.json();if(!d.success){setText('scheduleNotice',d.message);return;}
    barbers=d.staff||[];const staffSkills=new Map(),apptServices=new Map();
    for(const row of d.staff_services||[]){if(!staffSkills.has(Number(row.staff_id)))staffSkills.set(Number(row.staff_id),new Set());staffSkills.get(Number(row.staff_id)).add(Number(row.service_id));}
    for(const row of d.appointment_services||[]){if(!apptServices.has(Number(row.appointment_id)))apptServices.set(Number(row.appointment_id),new Set());apptServices.get(Number(row.appointment_id)).add(Number(row.service_id));}
    const tbody=document.getElementById('dailyRows');tbody.replaceChildren();
    for(const appt of d.bookings){const tr=document.createElement('tr');addCell(tr,String(appt.appointment_time||'').slice(0,5));addCell(tr,appt.client_name);addCell(tr,branches.find(x=>Number(x.branch_id)===Number(appt.branch_id))?.name||appt.branch_id);addCell(tr,appt.service_ids);addCell(tr,appt.status);
        const td=document.createElement('td');
        if(scheduleUser.role==='admin'&&!['Completed','Cancelled','Rejected'].includes(appt.status)){
            const select=document.createElement('select'),unassigned=document.createElement('option');unassigned.value='';unassigned.textContent='Awaiting assignment';select.append(unassigned);
            for(const s of barbers.filter(s=>Number(s.branch_id)===Number(appt.branch_id)&&[...(apptServices.get(Number(appt.appointment_id))||[])].every(id=>staffSkills.get(Number(s.staff_id))?.has(id)))){const op=document.createElement('option');op.value=s.staff_id;op.textContent=s.name+' — '+(s.specialization||'Qualified');select.append(op);}
            select.value=appt.staff_id||'';
            if(!appt.staff_id && appt.requested_staff_id){
                const preferred=barbers.find(s=>Number(s.staff_id)===Number(appt.requested_staff_id));
                const preference=document.createElement('div');preference.className='requested-barber';
                preference.textContent='Requested: '+(preferred?.name||'Barber #'+appt.requested_staff_id)+' — verify qualifications before assignment';
                td.append(preference);
            }
            const button=document.createElement('button');button.type='button';button.textContent='Assign';button.onclick=async()=>{
                if(!select.value)return setText('scheduleNotice','Select a barber.');
                const r=await Auth.apiFetch('/api/bookings/assign',{method:'PUT',body:JSON.stringify({appointment_id:appt.appointment_id,staff_id:Number(select.value)})});
                if(!r)return;const result=await r.json();setText('scheduleNotice',result.message);if(result.success)await loadSchedule();
            };
            td.append(select,' ',button);
        }else td.textContent=barbers.find(s=>Number(s.staff_id)===Number(appt.staff_id))?.name||'Unassigned';
        if(!appt.staff_id)td.classList.add('waiting');tr.append(td);tbody.append(tr);
    }
    const qualifications=document.getElementById('qualificationBarber');
    if(qualifications){const selected=qualifications.value;qualifications.replaceChildren();
        for(const s of barbers){const op=document.createElement('option');op.value=s.staff_id;op.textContent=s.name+' ('+(s.specialization||'')+')';qualifications.append(op);}
        if([...qualifications.options].some(o=>o.value===selected))qualifications.value=selected;
    }
    const select=document.getElementById('shiftBarber');select.replaceChildren();
    for(const staff of barbers){const op=document.createElement('option');op.value=staff.staff_id;op.textContent=staff.name;select.append(op);}
    if(qualifications && scheduleUser.role==='admin'){
      const skills=document.getElementById('qualificationList');skills.replaceChildren();
      const barber=barbers.find(x=>Number(x.staff_id)===Number(qualifications.value));
      for(const service of (window.scheduleServices||[])){
        const label=document.createElement('label'),box=document.createElement('input');
        box.type='checkbox';box.value=service.service_id;
        box.checked=staffSkills.get(Number(qualifications.value))?.has(Number(service.service_id))||false;
        const branchServices=window.branchServiceLinks||[];
        box.disabled=barber?(!branchServices.some(x=>Number(x.branch_id)===Number(barber.branch_id)&&Number(x.service_id)===Number(service.service_id)&&Number(x.is_active)===1)):false;
        label.append(box,' '+service.name);skills.append(label);
      }
    }
    const table=document.getElementById('shiftRows');table.replaceChildren();
    for(const shift of d.shifts){const tr=document.createElement('tr');for(const val of [barbers.find(s=>Number(s.staff_id)===Number(shift.staff_id))?.name||shift.staff_id,['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][shift.weekday],String(shift.start_time).slice(0,5),String(shift.end_time).slice(0,5),shift.is_active?'Yes':'No'])addCell(tr,val);table.append(tr);}
    setText('scheduleNotice',`${d.bookings.length} appointments on ${p.get('date')}; ${d.bookings.filter(a=>!a.staff_id&&!['Cancelled','Completed','Rejected'].includes(a.status)).length} still require assignment.`);
}
document.addEventListener('DOMContentLoaded',async()=>{
    const me=await Auth.me();if(!me||!['admin','staff'].includes(me.role)){Auth.logout('expired');return;}scheduleUser=me;
    const b=await Auth.apiFetch('/api/branches');if(b?.ok){const d=await b.json();branches=d.branches||[];}
    const choice=document.getElementById('branchChoice');for(const branch of branches){const op=document.createElement('option');op.value=branch.branch_id;op.textContent=branch.name;choice.append(op);}
    if(me.role==='admin'){
        const q=await Auth.apiFetch('/api/users/qualifications');
        if(q?.ok){const data=await q.json();window.scheduleServices=data.services||[];
          const links=await Auth.apiFetch('/api/services/links');if(links?.ok)window.branchServiceLinks=(await links.json()).branch_services||[];}
        document.getElementById('qualificationBarber').addEventListener('change',loadSchedule);
        document.getElementById('qualificationForm').onsubmit=async e=>{
            e.preventDefault();const id=Number(document.getElementById('qualificationBarber').value);
            if(!id)return setText('scheduleNotice','Select a barber.');
            const ids=[...document.querySelectorAll('#qualificationList input:checked:not(:disabled)')].map(el=>Number(el.value));
            const r=await Auth.apiFetch('/api/users/qualifications',{method:'PUT',body:JSON.stringify({staff_id:id,service_ids:ids})});
            if(!r)return;const result=await r.json();setText('scheduleNotice',result.message);if(result.success)await loadSchedule();
        };
    }
    if(me.role==='staff'){choice.value=me.branch_id;choice.disabled=true;document.getElementById('shiftEditor').style.display='none';}
    document.getElementById('workDate').value=ymd();
    document.getElementById('dateSelection').onsubmit=e=>{e.preventDefault();loadSchedule().catch(err=>setText('scheduleNotice',err.message));};
    document.getElementById('shiftForm').onsubmit=async e=>{e.preventDefault();const data={staff_id:Number(document.getElementById('shiftBarber').value),weekday:Number(document.getElementById('shiftDay').value),start_time:document.getElementById('shiftStart').value,end_time:document.getElementById('shiftEnd').value};const r=await Auth.apiFetch('/api/users/schedule',{method:'PUT',body:JSON.stringify(data)});if(!r)return;const d=await r.json();setText('scheduleNotice',d.message||'Saved staff availability');if(d.success)loadSchedule();};
    await loadSchedule();
});
