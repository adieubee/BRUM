## 1.2.1 — Demo login quick-fill restored

- Restored the original three demo-account buttons on `/login.html` (`admin`, `staff_malolos`, `client1`, all `123`) with accessible HTML buttons.
- Clicking a button fills credentials but **does not authenticate** or bypass the normal login form and backend security.
- Added demo-login regression tests and a README warning about using public credentials outside a test environment.

# BRUMS audited upgrade — October 11, 2026

## Implemented

- Server-side sessions: signed tokens, token-hash storage, idle timeout (20 minutes), absolute lifetime (12 hours), logout invalidation, current-role verification, staff-branch verification, on-screen warning before inactivity timeout.
- Login throttling: three incorrect passwords for the same normalized identifier trigger a 15-minute lockout. Clients can only self-register as clients.
- Role matrix: `admin`, `staff`, and `client`. Admin account/role controls revoke all previous sessions on updates, keep role-profile data synchronized, and disable old staff membership without deleting appointment history.
- Audit log for sign-ins, role changes, staff/schedule changes, appointment lifecycle, stock changes, checkout, and report exports; admin-side date and text filters.
- Pseudonymous visitor log with page, account (when signed in), timestamp, hashed source IP, and 30-day totals. No raw IP is stored.
- Admin report filters for date, branch, and branch/staff search; branch totals, cancelled appointments, average ticket, recent transactions, and CSV/JSON report export (10,000-row safety limit). CSV escapes formula-like inputs.
- Admin-only JSON API snapshot download containing business data (no passwords/tokens). This is a local export file, **not a two-way offline cache or scheduled backup**.
- Admin timetable with native calendar/time controls, daily appointment roster, selectable barber assignment, overlapping-booking checks, optional weekly staff shifts, and staff read-only timetable.
- Explicit ERD relationships via `admins`, `clients`, `staff`, `branch_services`, `appointment_services`, `service_inventory`, and `staff_availability`.
- Fixed API authorization for booking, history, inventory, and finance endpoints; staff branch-scoping; server-side POS totals and inventory locking; finance staff foreign-key name clarity; narrowed unsafe public assets; repaired legacy inventory quantity typo.
- New `scripts/backfill-appointment-services.js` reconstructs normalized service counts from legacy appointment CSV values.
- Safe errors (no database credentials in API responses), and basic Node security tests.

## Known limitations / release checklist

- A live MySQL/Vercel deployment was **not available in the coding environment**. Run `npm test`, import into a disposable staging MySQL database, verify `npm run migrate:services`, and manually test each role before production rollout.
- Payment success in this legacy project is a **demo confirmation**, not verified payment capture. It is disabled in production unless `ALLOW_DEMO_PAYMENTS=true`. Do **not** enable this flag on a real, publicly available payment-taking site; integrate verified payment gateway webhooks and proper deposit accounting instead.
- No-preference appointments remain unallocated until an admin assigns a barber; the booking form does not reserve capacity from the unassigned queue. Admins must monitor and resolve all open assignments.
- Service-to-inventory links describe dependencies only. Automatic per-service inventory consumption and notifications via push/email/SMS are not included.
- Admin JSON snapshot is a **manual download**. It is not an encrypted automated backup, conflict-resolving offline sync, or full disaster recovery system. Use regular secure database backups for production.
- The login throttle is by account identifier, not an IP-level firewall. Add an edge/WAF rate limit against distributed abuse in a public deployment.
- Export refuses unfiltered results exceeding 10,000 POS rows rather than silently returning incomplete totals.
- `TOKEN_SECRET` must be a random 32+-character value in production. Rotate all seeded passwords and restrict DB credentials.


## 2026-10-12 — Round 2: management and scheduling requests

- Added the dedicated admin visitor dashboard (`/admin/visitors.html`), integrating filtered website page-view history with a distinct, auditable appointment in-person check-in/out log (`appointment_visits`). Front-desk status is limited to confirmed/in-progress/completed bookings; cancelled/rejected appointments cannot check in.
- Added the explicit staff specialization junction (`staff_services`), qualification editing under Barber Timetable, and strict qualification checks for both client-selected and admin-assigned barbers. The demo installation seeds illustrative staff skills. For upgraded installations, admins must explicitly approve skills to avoid invented qualifications.
- Added an admin-only `/api/bookings/reject` endpoint, required reason (5–500 characters), transaction locking, booking history/audit event, terminal `Rejected` status, and slot release. Rejected appointments are excluded from timetable conflicts, POS checkout, and active-demand counts.
- Added a safe admin database editor (`/admin/database.html` and `/api/data-admin`): account profiles, branch details, services, with strict allowlisted fields and audit events; no raw SQL or destructive operations. Inventory and service relationship edits stay in their existing pages.
- Reports now answer management questions about bookings by status, most-requested services, busiest branches, peak hours, and actual attendance. Same date/branch filters used; insight figures group by appointment date, while financial totals follow sale date. Existing downloadable CSV/JSON summaries remain.
- Added native date and time browser inputs to client booking, with available-time feedback and server-rechecked collisions. Role change and branch transfer also purge former staff specialization grants.
- Updated the ERD and clean-install SQL. New tables are created by `ensureSchema()` in existing environments; no drop/reinstall is needed for upgrade. The full SQL dump remains **destructive** and must never be imported over live data.

**Limits:** No live MySQL or web-browser integration environment was provided. Automated tests and syntax checks cannot guarantee production schema/data compatibility. EmailJS is best-effort and is not a push notification service; the payment success page remains a gated demo flow. Local JSON copies are not automatic encrypted backups or offline synchronization.
