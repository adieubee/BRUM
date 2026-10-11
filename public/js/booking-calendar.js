/* Accessible inline calendar + server-sourced availability for BRUM. No framework dependencies. */
(function () {
    'use strict';
    const pad = n => String(n).padStart(2,'0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const todayInManila = () => {
        const p = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
        const get = type => p.find(x=>x.type===type).value;
        return `${get('year')}-${get('month')}-${get('day')}`;
    };
    const labelTime = str => {
        const [h,m] = str.split(':').map(Number);
        return `${(h%12)||12}:${pad(m)} ${h<12?'AM':'PM'}`;
    };
    function mount({ branch, barber, date, time, services }) {
        const grid = document.getElementById('bookingCalendarDays');
        const times = document.getElementById('bookingTimeSlots');
        const feedback = document.getElementById('timeAvailability');
        const monthTitle = document.getElementById('bookingMonthLabel');
        const duration = document.getElementById('bookingDuration');
        const prev = document.getElementById('bookingPrevMonth');
        const next = document.getElementById('bookingNextMonth');
        const monthZero = todayInManila().slice(0,7);
        let shownMonth = monthZero;
        let requestCount = 0;
        let knownSlots = [];
        let loading = false;
        let checkedSignature = '';
        const signature = () => [branch.value, date.value, barber.value, services().join(','), time.value].join('|');
        function message(text, type='') {
            feedback.textContent = text;
            feedback.className='booking-feedback'+(type?' '+type:'');
        }
        function dateAllowed(day) {
            return day >= todayInManila();
        }
        function renderMonth() {
            const [y,m] = shownMonth.split('-').map(Number);
            const first = new Date(y,m-1,1);
            monthTitle.textContent = new Intl.DateTimeFormat('en-PH',{month:'long',year:'numeric'}).format(first);
            prev.disabled = shownMonth <= monthZero;
            grid.replaceChildren();
            for (let i=0; i<first.getDay(); i++) {
                const el=document.createElement('span');el.className='booking-day empty';grid.appendChild(el);
            }
            const max = new Date(y,m,0).getDate();
            for (let n=1;n<=max;n++) {
                const d=`${shownMonth}-${pad(n)}`;
                const button=document.createElement('button');
                button.type='button';button.className='booking-day';button.textContent=String(n);
                button.setAttribute('aria-label',new Intl.DateTimeFormat('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date(y,m-1,n)));
                button.setAttribute('aria-pressed',String(date.value===d));
                if(d===todayInManila())button.classList.add('today');
                if(d===date.value)button.classList.add('selected');
                button.disabled=!dateAllowed(d);
                button.addEventListener('click',()=>{date.value=d;time.value='';renderMonth();refresh();});
                grid.appendChild(button);
            }
        }
        function renderSlots(slots, emptyText="Select a date to view appointment times.") {
            times.replaceChildren();
            if(!slots.length){
                const el=document.createElement('div');el.className='booking-times-placeholder';
                el.textContent=emptyText;
                times.appendChild(el);return;
            }
            for (const slot of slots) {
                const button=document.createElement('button');button.type='button';
                const selectable=['available','request'].includes(slot.status);
                button.className='booking-time '+slot.status+(time.value===slot.time?' selected':'');
                button.disabled=!selectable;
                button.title=slot.reason;
                button.setAttribute('aria-label',`${labelTime(slot.time)}. ${slot.reason}`);
                button.setAttribute('aria-pressed',String(time.value===slot.time));
                const t=document.createElement('span');t.className='time-label';t.textContent=labelTime(slot.time);
                const s=document.createElement('span');s.className='slot-status';
                s.textContent=({available:'Available',request:'Request',booked:'Booked',past:'Passed','off-duty':'Off duty',closed:'Closed'})[slot.status]||slot.status;
                button.append(t,s);
                button.addEventListener('click',()=>{
                    time.value=slot.time;
                    checkedSignature=signature();
                    renderSlots(knownSlots);
                    message(slot.status==='request'?'Requested time selected. An admin must assign and confirm your barber.':`${labelTime(slot.time)} is available for the selected barber and services.`,'success');
                });
                times.appendChild(button);
            }
        }
        async function refresh() {
            const thisRequest=++requestCount;
            time.value='';checkedSignature='';knownSlots=[];renderSlots([]);
            const ids=services();
            if(!branch.value){duration.textContent='Select branch';message('Select your branch to see available appointments.');return;}
            if(!ids.length){duration.textContent='Choose services';message('Choose your service(s) first. Availability depends on how long each service takes.');return;}
            if(!barber.value){duration.textContent='Choose barber';message('Choose a barber or No Preference to see available times.');return;}
            if(!date.value){duration.textContent='Select date';message('Choose a date on the calendar.');return;}
            const params=new URLSearchParams({branch_id:branch.value,date:date.value,staff_id:barber.value,service_ids:ids.join(',')});
            times.replaceChildren();const placeholder=document.createElement('div');placeholder.className='booking-times-placeholder';placeholder.textContent='Checking available times…';times.appendChild(placeholder);
            message('Checking live availability…');loading=true;
            try {
                const response=await Auth.apiFetch('/api/bookings/availability?'+params);
                if(!response)throw new Error('Could not load availability. Sign in again.');
                const result=await response.json();
                if(thisRequest!==requestCount)return;
                if(!response.ok||!result.success)throw new Error(result.message||'Could not check availability.');
                knownSlots=result.slots||[];
                duration.textContent=`${result.duration_minutes} min total`;
                renderSlots(knownSlots);
                const free=knownSlots.filter(s=>s.status==='available'||s.status==='request').length;
                const booked=knownSlots.filter(s=>s.status==='booked').length;
                const selectedName=barber.options[barber.selectedIndex]?.textContent||'Barber';
                if(free && result.schedule_published===false)message(`${selectedName} has no published weekly shift schedule yet. Times shown are tentative and must be confirmed by the admin.`);
                else if(free)message(result.provisional
                    ?`${free} request times shown. No Preference means the admin will assign a qualified barber; a time is not reserved until assigned.`
                    :`${free} available times for ${selectedName}.${booked?` ${booked} blocked by existing bookings.`:''} Select an available time.`);
                else message(`No times available for ${selectedName} on this date. Try another barber or day.`,'error');
            }catch(err){
                if(thisRequest!==requestCount)return;
                knownSlots=[];renderSlots([]);
                message(err.message||'Availability could not be loaded. Please try again.','error');
            }finally{if(thisRequest===requestCount)loading=false;}
        }
        async function ensureSelected() {
            if(loading)return {ok:false,message:'Please wait for availability to finish loading.'};
            if(!date.value||!time.value)return {ok:false,message:'Choose a calendar date and an available time slot.'};
            const originalTime=time.value;
            const originalSignature=signature();
            const params=new URLSearchParams({branch_id:branch.value,date:date.value,staff_id:barber.value,service_ids:services().join(',')});
            try {
                const response=await Auth.apiFetch('/api/bookings/availability?'+params);
                if(!response)return {ok:false,message:'Unable to verify availability. Please sign in again.'};
                const result=await response.json();
                if(!response.ok||!result.success)throw new Error(result.message||'Availability unavailable.');
                if(signature()!==originalSignature) return {ok:false,message:'Booking details changed. Re-select an available time.'};
                const slot=(result.slots||[]).find(s=>s.time===originalTime);
                if(!slot||!['available','request'].includes(slot.status)){
                    await refresh();
                    return {ok:false,message:`${labelTime(originalTime)} is no longer available. Please select another time.`};
                }
                checkedSignature=signature();
                return {ok:true};
            }catch(err){return {ok:false,message:err.message||'Unable to verify availability.'};}
        }
        prev.addEventListener('click',()=>{
            const [y,m]=shownMonth.split('-').map(Number);
            shownMonth=iso(new Date(y,m-2,1)).slice(0,7);date.value='';time.value='';renderMonth();refresh();
        });
        next.addEventListener('click',()=>{
            const [y,m]=shownMonth.split('-').map(Number);
            shownMonth=iso(new Date(y,m,1)).slice(0,7);date.value='';time.value='';renderMonth();refresh();
        });
        renderMonth();renderSlots([]);
        message('Select your branch, services, barber and calendar date to see available times.');
        return { refresh, ensureSelected, message, labelTime, get busy(){return loading;}, get selectedValid(){return Boolean(time.value&&checkedSignature===signature());} };
    }
    window.BookingCalendar={mount,labelTime};
})();
