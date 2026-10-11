# BRUMS — audited version: setup, deployment, and data migration

## Important: upgrading safely

**Back up your current MySQL database before deployment.** Do **not** import `database_dump.sql` over an existing installation; it begins with `DROP TABLE` statements and is for clean demo installs only. Updated handlers run compatible database migrations automatically on the first request. If your production MySQL account cannot run DDL, apply `migrations/2026-10-12-round2.sql` with a database administrator first. After that, run `npm run migrate:services` once to backfill multi-service legacy appointments. It is repeatable, and the source data remains intact.

## Local development

1. Install Node.js, MySQL 8+ and Vercel CLI (`npm install -g vercel`).
2. Create an empty MySQL database named `brums`. On an empty fresh installation only, import `database_dump.sql`.
3. In the project root, run `npm install`.
4. Create a private `.env` from `.env.example` and fill the database connection properties.
5. Start `vercel dev` and open the URL printed in the console.
6. Run `npm run migrate:services` to sync old appointment selections. Run `npm test` to execute automated security checks.

MySQL variables: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_SSL`. Never expose these through the static public directory.

**Production:** set `NODE_ENV=production`, `TOKEN_SECRET` to a randomly generated string of 32 or more characters, `AUDIT_SALT` to another private random string, `APP_BASE_URL` to your actual site origin, and protected MySQL credentials. Configure automated backups and use a dedicated least-privilege DB user. This upgrade removes duplicate backend/API/database files accidentally placed under `public/`.

## Features and navigation

| Page | Who can use it | What it does |
|---|---|---|
| `/admin/visitors.html` | Admin | Website visitor metrics and in-person appointment check-in/out |
| `/admin/database.html` | Admin | Profile/branch/service editor and local snapshot preview |
| `/admin/operations.html` | Admin | Audit log, visitor history, account role changes and session revocation |
| `/admin/schedule.html` | Admin | Calendar-format day view, unassigned bookings, barber allocation and weekly shifts |
| `/staff/schedule.html` | Staff | Read-only branch roster and timetable |
| `/admin/service-links.html` | Admin | Explicit service↔branch and service↔inventory relationships |
| `/admin/reports.html` | Admin | Searchable/date-filtered sales summary, CSV/JSON report downloads, manual JSON business-data snapshot |

Sessions last at most 12 hours and expire after 20 minutes without an authorized API request. Client pages warn of impending inactivity expiry; the server enforces the timeout. Three incorrect password attempts against one login identifier trigger a 15-minute timeout.

New admin screens:
- `/admin/visitors.html` — website page views and in-person appointment check-ins/check-outs (separate data sets).
- `/admin/database.html` — audited profile, branch, and service editing with a restricted schema-aware API. Inventory and relationship editors remain on their dedicated pages.
- `/admin/schedule.html` — assign precise service specializations to each barber, review daily bookings, assign barbers and publish working hours.
- `/admin/appointments.html` — reject pending/confirmed bookings with a mandatory reason (admin only).
- `/admin/reports.html` — management insights: appointment outcomes, top services, peak hours, busiest branch, and check-in volume. Date and branch filters apply; free-text search is for financial records only.

**Crucial for upgraded databases:** Existing barbers have no service specializations until the admin checks and saves their actual competencies under Barber Timetable; this is intentionally fail-closed. Staff accounts retain their current profile records, but permissions and session tokens are revoked immediately when their role changes. Role- and branch-specific skills are cleared when staff status/branch changes. Prior appointments remain for audit purposes.

No barber preference is stored as `appointments.staff_id=NULL` until an admin chooses an available active barber at the requested branch/time. The timetable rejects overlapping allocations. **Unassigned bookings are pending allocation, not a guaranteed barber assignment**; admins must review open bookings and avoid overselling available capacity.

## Demo logins (local and classroom testing only)

The login page retains three clickable demo credentials from the original project: `admin / 123`, `staff_malolos / 123`, and `client1 / 123`. The buttons populate username/password only; the form still calls the server for authentication, and the three-failed-attempt lockout, sessions, and role restrictions remain active. These accounts are included in the clean-install `database_dump.sql`; they are **not** created by upgrading an existing database. If you are upgrading a database that lacks them, the buttons will not magically make them work.

**Security warning:** The sample password is publicly visible and not appropriate for an internet-facing deployment. On a real deployment, remove/disable the demo credentials, change the sample passwords (or delete the accounts), and revoke their active sessions. Do not use the bundled demo database as production data.

## Payment and notification limitations

The original project's payment success page is only a **demo confirmation**, not payment gateway verification. It is blocked in production by default. Enabling `ALLOW_DEMO_PAYMENTS=true` is only suitable in a closed test environment. Real online payments need a verified gateway webhook and reconciled deposits before a live launch. Email confirmations use EmailJS if configured; browser session warnings do not send push/SMS.

The admin-only API snapshot contains operational entities and their relational mapping (`branch_services`, `service_inventory`, `appointment_services`, `staff_services`) as well as in-person visit timestamps. It is downloaded to the browser and can be previewed locally without uploading. Protect this JSON file as it includes appointment metadata. Manual API snapshot export is an admin-only downloadable JSON file and does **not** replace database backups or support offline write synchronization. Relation data in `service_inventory` describes quantities used, but automatic deduction of service materials is not performed. See `ERD.md` and `CHANGELOG.md` for the complete diagram and remaining limitations.

## Testing and deployment checklist

Run `npm test`, then test with a disposable MySQL database and real browser sessions. Verify three failed login attempts / lockout, valid login, admin/staff/client route isolation, role change logout, explicit barber service skills (including no-skill failure), appointment rejection reason and slot release, in-person check-in/out state transitions and role checks, safe data editor updates, calendar assignment collision, filters and downloaded file contents, admin visitor/audit history, appointment creation/checkout, and migration of multi-service legacy bookings. Rotate all stock/demo credentials before going live.

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
