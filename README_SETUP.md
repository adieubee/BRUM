# BRUMS / Barber R Us - Local Setup

## Run locally
1. Start MySQL and make sure a database named `brums` exists.
2. If starting fresh, import `database_dump.sql`.
3. Run `npm install`.
4. Run `vercel dev` from this project folder.
5. Open the local URL shown by Vercel (normally `http://localhost:3000`).

## Local database defaults
The app uses environment variables when available and falls back to:
- Host: `localhost`
- Port: `3306`
- User: `root`
- Password: `root`
- Database: `brums`

Optional environment variables: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_SSL`.

## Existing database upgrades
You do not need to wipe your existing `brums` database for this fixed build. On the first API request, the backend checks and repairs the expected schema, including:
- creating the missing `finance` table;
- renaming the legacy inventory `quantitiy` column to `quantity`;
- adding booking/POS fields such as `dp_paid`, `warts_dp`, and `non_warts_price`;
- allowing staff/walk-in user records to have no email address.

## Demo login
The login page contains buttons for the seeded demo users. The seeded SQL uses the same existing password hash from the supplied project; if you previously changed passwords in your database, use your current database passwords instead.

## Email (EmailJS)
Booking confirmation emails are sent from the browser using EmailJS, which is the correct fit for a private/local app.

Configure the following values in `.env`:
```env
EMAILJS_PUBLIC_KEY=your_emailjs_public_key
EMAILJS_SERVICE_ID=your_emailjs_service_id
EMAILJS_TEMPLATE_ID=your_emailjs_template_id
```

The app already includes a server route at `/api/emailjs-config` that exposes these values to the page safely. The client page loads EmailJS and sends the confirmation email after booking confirmation succeeds.

If these values are blank, the booking still works but the email is skipped.

### EmailJS service setup
1. Create an EmailJS account.
2. Add an Email Service and connect it to Gmail or another supported provider.
3. Create a template with the following variables:
   - `to_email`
   - `client_name`
   - `appointment_date`
   - `appointment_time`
   - `branch_address`
   - `services`
   - `booking_url`
   - `message`
   - `subject`
4. Copy the Public Key, Service ID, and Template ID into `.env`.

### Recommended template content
```text
Subject: {{subject}}

Hello {{client_name}},

Your appointment has been confirmed.

Date: {{appointment_date}}
Time: {{appointment_time}}
Branch: {{branch_address}}
Services: {{services}}
Message: {{message}}

View your booking:
{{booking_url}}

Thank you,
Barber R Us
```

This matches the app's booking confirmation flow and keeps the setup working without a public domain or backend email secret.
