let links={};
const label=(id,val)=>document.getElementById(id).textContent=String(val||'');
const putOptions=(id,rows,key,name)=>{const el=document.getElementById(id);el.replaceChildren();for(const row of rows){const op=document.createElement('option');op.value=row[key];op.textContent=row[name];el.append(op);}};
function rowFor(target,values){const row=document.createElement('tr');for(const val of values){const c=document.createElement('td');c.textContent=String(val??'');row.append(c);}target.append(row);}
async function loadLinks(){const r=await Auth.apiFetch('/api/services/links');if(!r)return;const d=await r.json();if(!d.success){label('linkMessage',d.message);return;}links=d;
    putOptions('linkBranch',d.branches,'branch_id','name');putOptions('linkService',d.services,'service_id','name');putOptions('inventoryService',d.services,'service_id','name');
    const inventory=d.inventory.map(item=>({...item,label:`${item.item_name} — branch ${item.branch_id} (${item.quantity} in stock)`}));putOptions('linkInventory',inventory,'inventory_id','label');
    const branchRows=document.getElementById('branchRows');branchRows.replaceChildren();
    for(const rel of d.branch_services){rowFor(branchRows,[d.branches.find(b=>b.branch_id===rel.branch_id)?.name||rel.branch_id,d.services.find(s=>s.service_id===rel.service_id)?.name||rel.service_id,rel.is_active?'Yes':'No']);}
    const materialRows=document.getElementById('materialRows');materialRows.replaceChildren();
    for(const rel of d.service_inventory){rowFor(materialRows,[d.services.find(s=>s.service_id===rel.service_id)?.name||rel.service_id,d.inventory.find(i=>i.inventory_id===rel.inventory_id)?.item_name||rel.inventory_id,rel.quantity_used]);}
}
async function save(data){const r=await Auth.apiFetch('/api/services/links',{method:'PUT',body:JSON.stringify(data)});if(!r)return;const d=await r.json();label('linkMessage',d.message||'Saved.');if(d.success)await loadLinks();}
document.addEventListener('DOMContentLoaded',async()=>{const me=await Auth.me();if(!me||me.role!=='admin'){Auth.logout('expired');return;}
    document.getElementById('branchLinks').onsubmit=e=>{e.preventDefault();save({type:'branch',branch_id:Number(document.getElementById('linkBranch').value),service_id:Number(document.getElementById('linkService').value),is_active:document.getElementById('linkActive').value==='true'});};
    document.getElementById('inventoryLinks').onsubmit=e=>{e.preventDefault();save({type:'inventory',service_id:Number(document.getElementById('inventoryService').value),inventory_id:Number(document.getElementById('linkInventory').value),quantity_used:Number(document.getElementById('linkQuantity').value)});};
    await loadLinks();
});
