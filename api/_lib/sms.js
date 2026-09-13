const TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY;
const TEXTBEE_DEVICE_ID = process.env.TEXTBEE_DEVICE_ID;

/**
 * Sends an SMS using the Textbee API.
 * @param {string} phoneNumber - The recipient's phone number.
 * @param {string} message - The SMS body to send.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function sendSMS(phoneNumber, message) {
    if (!phoneNumber) return false;

    if (!TEXTBEE_API_KEY || !TEXTBEE_DEVICE_ID) {
        console.error('❌ Textbee API Key or Device ID is missing in environment variables.');
        return false;
    }

    // Format phone number to ensure it has the Philippine country code +63 if it starts with 09
    let formattedNumber = phoneNumber.trim();
    if (formattedNumber.startsWith('09') && formattedNumber.length === 11) {
        formattedNumber = '+63' + formattedNumber.substring(1);
    }

    try {
        const response = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${TEXTBEE_DEVICE_ID}/send-sms`, {
            method: 'POST',
            headers: {
                'x-api-key': TEXTBEE_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                receivers: [formattedNumber],
                smsBody: message
            })
        });

        if (response.ok) {
            console.log(`✅ SMS successfully sent to ${formattedNumber}`);
            return true;
        } else {
            const errorData = await response.text();
            console.error(`❌ Textbee SMS Error [${response.status}]:`, errorData);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to send SMS via Textbee:', error.message);
        return false;
    }
}

/**
 * Auto-generates a booking confirmation message.
 * @param {string} date - The appointment date.
 * @param {string} time - The appointment time.
 * @param {string} branchAddress - The branch address.
 * @param {string} services - Display name of the services booked.
 * @returns {string} The formatted SMS message.
 */
function generateBookingConfirmationMessage(date, time, branchAddress, services) {
    return `Hello! Your appointment at Facial R Us has been successfully confirmed. ✨

Date: ${date}
Time: ${time}
Address: ${branchAddress}
Service/s: ${services}

Thank you for securing your slot with a 20% down payment. Please arrive 10–15 minutes before your scheduled time.

Reminder before your appointment: Please avoid exfoliating, using harsh products (retinoids or acids), waxing, shaving, or tanning for at least 48 hours prior to your treatment.

Appointments can only be cancelled or rescheduled with at least 72 hours notice. No refunds will be given for no-shows.
Down payment is non-refundable.

We look forward to seeing you!`;
}

/**
 * Auto-generates a booking reminder message.
 * @param {string} clientName - The client's name.
 * @param {string} date - The appointment date.
 * @param {string} time - The appointment time.
 * @param {string} branchName - The branch name.
 * @param {string} branchAddress - The branch address.
 * @returns {string} The formatted SMS message.
 */
function generateBookingReminderMessage(clientName, date, time, branchName, branchAddress) {
    return `FRUMS Reminder: Hi ${clientName}, just a friendly reminder of your appointment tomorrow, ${date} at ${time} in our ${branchName} branch (${branchAddress}).`;
}

module.exports = {
    sendSMS,
    generateBookingConfirmationMessage,
    generateBookingReminderMessage
};
