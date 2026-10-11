'use strict';

// BRUM bookings use Philippine local dates/times. Do not let browser or server timezone change the result.
const MANILA_OFFSET = '+08:00';
const STEP_MINUTES = 30;
const OPEN_MINUTES = 9 * 60;

function minutes(value) {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
    if (!match) return NaN;
    const h = Number(match[1]), m = Number(match[2]);
    return h < 24 && m < 60 ? h * 60 + m : NaN;
}
function hhmm(value) {
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function isoDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === date;
}
function weekday(date) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
function closingMinutes(date) { return [0,6].includes(weekday(date)) ? 18 * 60 : 20 * 60; }
function durationMinutes(value) { return Math.max(1, Math.ceil(Number(value) || 30)); }
function appointmentStartTime(date, time) {
    return Date.parse(`${date}T${hhmm(minutes(time))}:00${MANILA_OFFSET}`);
}
function withinBusinessHours(date, time, duration) {
    if (!isoDate(date)) return false;
    const start = minutes(time), length = durationMinutes(duration);
    return Number.isFinite(start) && start % STEP_MINUTES === 0 && start >= OPEN_MINUTES && start + length <= closingMinutes(date);
}
function evaluateTime({ date, time, duration = 30, reservations = [], shifts = [], staffChosen = false, requiresApproval = false, now = Date.now() }) {
    const start = minutes(time), length = durationMinutes(duration);
    if (!withinBusinessHours(date,time,length)) return { status:'closed', reason:'Outside business hours or insufficient time for services' };
    if (appointmentStartTime(date,time) <= now) return { status:'past', reason:'This time has already passed' };
    if (!staffChosen) return { status:'request', reason:'Barber assignment is pending admin approval' };
    if (shifts.length && !shifts.some(s => Number(s.weekday) === weekday(date)
        && start >= minutes(s.start_time) && start + length <= minutes(s.end_time))) {
        return { status:'off-duty', reason:'Selected barber is not on shift for this time' };
    }
    const overlaps = reservations.some(r => {
        const busyStart = minutes(r.appointment_time);
        const busyEnd = busyStart + durationMinutes(r.duration_minutes);
        return start < busyEnd && start + length > busyStart;
    });
    if (overlaps) return { status:'booked', reason:'Selected barber is already booked during this time' };
    if (requiresApproval) return { status:'request', reason:'Barber preference recorded; admin must verify service qualifications and assign the barber' };
    return { status:'available', reason:'Available for your selected services' };
}
function makeSlots({ date, duration = 30, reservations = [], shifts = [], staffChosen = false, requiresApproval = false, now = Date.now() }) {
    if (!isoDate(date)) return [];
    const slots = [];
    for (let start=OPEN_MINUTES; start<closingMinutes(date); start += STEP_MINUTES) {
        const time=hhmm(start);
        slots.push({ time, ...evaluateTime({ date,time,duration,reservations,shifts,staffChosen,requiresApproval,now }) });
    }
    return slots;
}
module.exports = { minutes, hhmm, isoDate, weekday, closingMinutes, durationMinutes, withinBusinessHours, evaluateTime, makeSlots };
