const fs = require('fs');
const path = require('path');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const TEMPLATE_PATH = path.join(__dirname, '..', '_templates', 'booking-confirmation.html');

function renderTemplate(vars) {
    let tpl = '';
    try {
        tpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    } catch (err) {
        tpl = '<div style="font-family: Arial, sans-serif; color:#333;">'
            + '<h2 style="color:#1a73e8;">{{companyName}}</h2>'
            + '<p>Hi {{clientName}},</p>'
            + '<p>Your appointment has been confirmed.</p>'
            + '<p><strong>Date:</strong> {{date}}<br><strong>Time:</strong> {{time}}<br><strong>Address:</strong> {{branchAddress}}<br><strong>Service/s:</strong> {{services}}</p>'
            + '<p>Thank you!</p>'
            + '</div>';
    }

    for (const key of Object.keys(vars || {})) {
        const value = vars[key] == null ? '' : escapeHtml(vars[key]);
        tpl = tpl.replace(new RegExp('{{\\s*' + key + '\\s*}}', 'g'), value);
    }

    tpl = tpl.replace(/{{\s*[^}]+\s*}}/g, '');
    return tpl;
}

function formatEmailDate(value) {
    if (!value) return '';

    const raw = String(value).trim();
    const isoMatch = raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
        const [year, month, day] = isoMatch[0].split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(parsed);
    }

    return raw;
}

function formatEmailTime(value) {
    if (!value) return '';

    const raw = String(value).trim();
    const match = raw.match(/^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/);
    if (!match) return raw;

    const hour24 = Number(match[1]);
    const minute = match[2];
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return `${hour12}:${minute} ${suffix}`;
}

function generateBookingConfirmationEmail({ clientName, date, time, branchAddress, services, bookingUrl, message }) {
    const subject = 'Your Barber R Us appointment is confirmed';
    const bookingLink = bookingUrl || `${APP_BASE_URL}/client/my-appointments.html`;
    const html = renderTemplate({
        companyName: 'Barber R Us',
        clientName: clientName || 'there',
        date: formatEmailDate(date),
        time: formatEmailTime(time),
        branchAddress: branchAddress || '',
        services: services || '',
        bookingUrl: escapeHtml(bookingLink),
        message: message || 'No additional message provided.'
    });

    const finalHtml = String(html).replace('{{bookingUrl}}', escapeHtml(bookingLink));
    return { subject, html: finalHtml };
}

module.exports = {
    generateBookingConfirmationEmail,
    formatEmailDate,
    formatEmailTime
};
