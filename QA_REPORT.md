# BRUMS v1.2.0 — audit and verification report

**Scope:** Round-two requirements (visitors and physical visits, role-revocation, ERD, database editing, branch-service-inventory links, management reports, native date/time, specializations and reject actions).

## Automated checks performed

- `npm test`: **11/11 passing** (login lockout and session validity, role/branch restrictions, protected reports and editor, rejection validation and terminal behavior, visitor check-in/out logic, barber skill input validation).
- `node --check api/*.js public/js/*.js`: passed.
- Embedded inline scripts from `public/**/*.html`: parsed with Node syntax checks.
- Local HTML link/file checks: relative links verified; absolute `/assets/*` references resolve under Vercel's public root.
- `BRUM-Editable-ERD.drawio`: syntactically valid editable XML, three focused sheets.

## Manual checks required before deployment

1. **Back up MySQL**, restore a copy into staging, and verify `ensureSchema()`/`migrations/2026-10-12-round2.sql` on real data. Clean `database_dump.sql` is destructive.
2. Run `npm run migrate:services` for legacy multiple-service bookings.
3. In admin timetable, explicitly set skills for existing barbers before taking bookings that request specific staff. Do not infer skills from the old `specialization` description.
4. Open admin Visitors: confirm date/branch filtering, check-in and out, and that rejected/cancelled records cannot check in.
5. Create a pending appointment and reject it: confirm client view, booking history reason, released staff capacity, and rejected booking excluded from POS.
6. Update a user role: confirm prior sessions fail; staff permissions are removed. Reassigning a staff branch requires reapproving their qualifications.
7. Check admin data editor, reports and downloaded JSON/CSV summaries with real financial records, including time zone/date boundaries.
8. Verify native date/time inputs on both desktop and mobile browsers; forms are constrained, but final availability is always validated server-side.
9. Complete verified payment-gateway integration before real payment acceptance; demo confirmation is not payment proof.

## Not verified in this environment

A live MySQL server and production hosting variables were not available. The browser environment blocked Chrome navigation, so end-to-end graphical interactions could not be completed. **Do not interpret the automated results as a guarantee of defect-free production behavior.**

## Operational caveats

- A booking without barber preference is **pending allocation**, not a guaranteed reservation with any particular staff member. The timetable enforces explicit skills and overlap checks when an admin assigns staff.
- The manual local API JSON snapshot is not an encrypted/automated backup and includes internal identifiers; access-control and retention policy are required.
- Appointment visit timestamps and website visitor page views are distinct; IP hashes are estimates of unique visitors, not unique people.
- `service_inventory` records consumption relationships but does not automatically deduct stock for each service; inventory deduction is handled by POS product sales only.
