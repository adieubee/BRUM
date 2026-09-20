# BRUMS / Barbers R Us - Local Setup

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

## Email
Booking confirmation emails require `RESEND_API_KEY`. If it is not configured, booking still works; the server simply logs that email sending is unavailable.
