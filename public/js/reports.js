const peso=v=>'₱'+Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const safeText=(el,s)=>{el.textContent=String(s??'');return el};
let lastReport;
function reportParams(){
    const p=new URLSearchParams();
    for(const key of ['start_date','end_date','branch_id','search']){
        const el=document.getElementById('filter_'+key);
        if(el && el.value && el.value!=='all')p.set(key,el.value);
    }
    return p;
}
async function loadReports(){
    const tbody=document.getElementById('reportTableBody');
    tbody.replaceChildren();
    const r=await Auth.apiFetch('/api/records/summary?'+reportParams());
    if(!r)return;
    const data=await r.json();
    if(!data.success){safeText(tbody,data.message||'Unable to fetch report.');return;}
    lastReport=data;
    const total=data.totals;
    safeText(document.getElementById('totalAppointments'),total.transactions);
    safeText(document.getElementById('totalRevenue'),peso(total.revenue));
    safeText(document.getElementById('avgTransaction'),peso(total.average_ticket));
    const max=Math.max(1,...data.branches.map(x=>x.revenue));
    const bars=document.getElementById('revenueBars');bars.replaceChildren();
    for(const row of data.branches){
        const tr=document.createElement('tr');
        for(const val of [row.branch_name,row.transactions,row.cancelled,peso(row.revenue),peso(row.average_ticket)]){
            const td=document.createElement('td');td.textContent=val;tr.appendChild(td);
        }
        tbody.appendChild(tr);
        const bar=document.createElement('div');bar.className='bar-row';
        const label=document.createElement('span');label.className='bar-label';label.textContent=row.branch_name;
        const track=document.createElement('div');track.className='bar-track red';
        const fill=document.createElement('div');fill.className='bar-fill red';fill.style.width=`${100*row.revenue/max}%`;track.appendChild(fill);
        const amount=document.createElement('span');amount.className='bar-value';amount.textContent=peso(row.revenue);
        bar.append(label,track,amount);bars.appendChild(bar);
    }
    if(!data.branches.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No results for these filters.';tr.appendChild(td);tbody.appendChild(tr);}
    document.getElementById('reportTableFoot').replaceChildren();
    const tfoot=document.getElementById('reportTableFoot'),tr=document.createElement('tr');
    for(const val of ['TOTAL',total.transactions,total.cancelled,peso(total.revenue),peso(total.average_ticket)]){
        const td=document.createElement('td');td.textContent=val;td.style.fontWeight='700';tr.appendChild(td);
    }
    tfoot.appendChild(tr);
    // Recent transaction details, based on the same server-side filters.
    const details=document.getElementById('transactionDetails');details.replaceChildren();
    for(const t of data.transactions){
        const tr=document.createElement('tr');
        const formattedDate=new Date(t.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'});
        for(const val of [formattedDate,t.branch_name,t.staff_name,peso(t.amount),t.payment_method]){
            const td=document.createElement('td');td.textContent=val??'';tr.appendChild(td);
        }
        details.appendChild(tr);
    }
    const notes=document.getElementById('reportNotes');notes.textContent=data.note||`${data.transactions.length} recent transaction(s) shown (up to 250).`;
    const services=document.getElementById('servicesBars');services.replaceChildren();
    const hint=document.createElement('p');hint.style.padding='15px';hint.textContent='Summary is based on completed POS sales. The detailed table below shows filtered transactions.';services.append(hint);
}
async function loadInsights(){
    const p=reportParams();p.delete('search');
    const r=await Auth.apiFetch('/api/records/insights?'+p);if(!r)return;
    const d=await r.json();if(!d.success)throw Error(d.message||'Could not load management insights.');
    safeText(document.getElementById('managementNote'),d.note);
    const container=document.getElementById('managementInsights');container.replaceChildren();
    const sum=x=>Object.entries(x||{}).map(([k,v])=>`${k}: ${v}`).join(' · ')||'No appointments';
    const cards=[
      ['How many bookings?',d.total_bookings+' bookings'],
      ['What happened to the bookings?',sum(d.status_counts)],
      ['Which branch is busiest?',d.busiest_branches[0]?`${d.busiest_branches[0].name}: ${d.busiest_branches[0].bookings} bookings`:'No bookings'],
      ['What services are most requested?',d.top_services.slice(0,4).map(x=>`${x.name} (${x.bookings})`).join(' · ')||'No bookings'],
      ['What are the peak booking hours?',d.busiest_hours.map(x=>`${String(x.hour).padStart(2,'0')}:00 (${x.appointments})`).join(' · ')||'No bookings'],
      ['How many customers visited?',`${d.attendance.checkins||0} check-ins · ${d.attendance.checkouts||0} check-outs`]
    ];
    for(const [heading,answer] of cards){const node=document.createElement('section');node.style.cssText='border:1px solid #e5d8ca;border-radius:10px;padding:16px;background:#fdf9f4';
      const h=document.createElement('h3'),a=document.createElement('p');h.textContent=heading;a.textContent=answer;node.append(h,a);container.append(node);}
}
async function downloadInsights(){
    try{
        const p=reportParams();p.delete('search');
        const r=await Auth.apiFetch('/api/records/insights?'+p);
        if(!r||!r.ok)throw Error('Cannot export management insights.');
        const blob=new Blob([JSON.stringify(await r.json(),null,2)],{type:'application/json'});
        const uri=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=uri;a.download='brums-management-insights-'+new Date().toISOString().slice(0,10)+'.json';a.click();
        setTimeout(()=>URL.revokeObjectURL(uri),3000);
    }catch(e){Auth.notify(e.message);}
}
async function exportReport(format){
    try{
        const p=reportParams();p.set('format',format);
        const response=await Auth.apiFetch('/api/records/export?'+p);
        if(!response||!response.ok)throw new Error('Unable to export this report.');
        const blob=await response.blob(),a=document.createElement('a'),url=URL.createObjectURL(blob);
        a.href=url;a.download='brums-report-'+new Date().toISOString().slice(0,10)+'.'+format;a.click();
        setTimeout(()=>URL.revokeObjectURL(url),5000);
    }catch(err){Auth.notify(err.message);}
}
async function snapshotData(){
    const r=await Auth.apiFetch('/api/records/snapshot');
    if(!r||!r.ok)return Auth.notify('Could not export API data snapshot.');
    const a=document.createElement('a'),url=URL.createObjectURL(await r.blob());
    a.href=url;a.download='brums-api-data-snapshot-'+new Date().toISOString().slice(0,10)+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function adminLogout(){if(confirm('Log out?'))Auth.logout();}
document.addEventListener('DOMContentLoaded',async()=>{
    const user=await Auth.me();
    if(!user||user.role!=='admin'){Auth.logout('expired');return;}
    const r=await Auth.apiFetch('/api/branches');
    if(r?.ok){const data=await r.json();
        const select=document.getElementById('filter_branch_id');
        for(const b of data.branches||[]){const op=document.createElement('option');op.value=b.branch_id;op.textContent=b.name;select.appendChild(op);}
    }
    document.getElementById('reportFilters').addEventListener('submit',e=>{e.preventDefault();Promise.all([loadReports(),loadInsights()]).catch(err=>Auth.notify(err.message));});
    await Promise.all([loadReports(),loadInsights()]).catch(err=>Auth.notify(err.message));
});
