const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function sendEmail({ to, subject, html }) {
    if (!to) return false;

    if (!RESEND_API_KEY) {
        console.error('Resend API key is missing. Set RESEND_API_KEY in the environment.');
        return false;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'onboarding@resend.dev',
                to,
                subject,
                html
            })
        });

        if (!response.ok) {
            console.error(`Resend email error [${response.status}]:`, await response.text());
            return false;
        }

        return true;
    } catch (error) {
        console.error('Failed to send email via Resend:', error.message);
        return false;
    }
}

function generateBookingConfirmationEmail({ clientName, date, time, branchAddress, services }) {
    return {
        subject: 'Your Facial R Us appointment is confirmed',
        html: `<p>Hi ${clientName},</p>
            <p>Your appointment at Facial R Us has been successfully confirmed.</p>
            <p><strong>Date:</strong> ${date}<br>
            <strong>Time:</strong> ${time}<br>
            <strong>Address:</strong> ${branchAddress}<br>
            <strong>Service/s:</strong> ${services}</p>
            <p>Thank you for securing your slot with a 20% down payment. Please arrive 10-15 minutes before your scheduled time.</p>
            <p>We look forward to seeing you!</p>`
    };
}

module.exports = { sendEmail, generateBookingConfirmationEmail };