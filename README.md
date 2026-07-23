# Discover Group — Finance Portal

Static site on GitHub Pages, backed by Supabase.
Payables (tour bookings + operational expense), receivables, finance reports.

## Status

The database is **live and configured**. `config.js` already points at it.

| | |
|---|---|
| Project | Discover Group Finance Portal |
| Ref | `umgyfichedkdehryqckt` |
| URL | https://umgyfichedkdehryqckt.supabase.co |
| Region | Singapore (ap-southeast-1) |

Already done: all tables, views, triggers, and RLS policies applied;
helper functions revoked from the public API; security advisors report
zero issues; anonymous read access verified as blocked.

## What you still need to do

### 1. Create your admin account

New signups are created **inactive** on purpose — registering alone grants
nothing.

In the Supabase dashboard: **Authentication → Users → Add user**. Enter
your email and a strong password, and tick "Auto Confirm User".

Then in **SQL Editor**:

```sql
update profiles
set role = 'admin', active = true, full_name = 'Your Name'
where id = (select id from auth.users where email = 'you@discovergrp.com');
```

Repeat per staff member with the right role:

| Role | Can do |
|---|---|
| `viewer` | Read everything, change nothing |
| `clerk` | Add bills, invoices, payments |
| `manager` | Clerk, plus delete records |
| `admin` | Everything, plus manage accounts |

### 2. Turn off public signups

**Authentication → Sign In / Providers → Email → disable "Allow new users
to sign up."** Without this, anyone can create an account. They'd land
inactive and see nothing, but there's no reason to allow it.

### 3. Add your vendors, clients and tours

The portal reads these when you record a bill. Quickest path is SQL Editor:

```sql
insert into vendors (name, category) values
  ('Philippine Airlines', 'airline'),
  ('Shangri-La Mactan', 'hotel'),
  ('Cebu Coach Transport', 'transportation'),
  ('Kawasan Falls', 'admission'),
  ('Maria Santos', 'guide'),
  ('Lantaw Native Restaurant', 'restaurant'),
  ('Cebu Business Park Realty', 'landlord'),
  ('Visayan Electric', 'utility');

insert into clients (name, type) values
  ('Sunrise Travel Agency', 'agency'),
  ('Nakamura Holdings', 'corporate');

insert into tours (code, title, start_date, end_date, pax, status) values
  ('DG-2608', 'Cebu & Bohol 5D4N', '2026-08-14', '2026-08-18', 24, 'planned');
```

### 4. Publish to GitHub Pages

```bash
cd finance-portal
git init
git add .
git commit -m "Finance portal"
git branch -M main
git remote add origin https://github.com/discovergrp/dgfinanceportal.git
git push -u origin main
```

**Settings → Pages → Source: main, / (root).** Live at:

```
https://discovergrp.github.io/dgfinanceportal/
```

### 5. Lock the origin

**Authentication → URL Configuration** → set Site URL to your Pages URL and
add it to Redirect URLs. This stops the key being used from another site.

## Booking department documents

A shared file library under **Booking dept → Documents**. Files live in a
private Supabase Storage bucket (`booking-docs`, 50 MB per file) and are
served only through short-lived signed URLs — nothing is ever public.

**Two access tiers:**

| Tier | Contents | Who can open |
|---|---|---|
| Internal | Rate sheets, budgets, invoices, trackers | Anyone signed in |
| Restricted | Passenger manifests | Managers and admins only |

Anything categorised as a **manifest** is filed as restricted automatically —
the category cannot be uploaded as internal. These files hold passport
numbers and dates of birth, so the tighter tier is the point. Both the
metadata row and the file itself are protected: the storage path is
prefixed `restricted/`, and the bucket policy checks that prefix
independently of the table.

**Only managers and admins can upload or delete.** Clerks and viewers can
read internal documents but cannot change the library.

Category is guessed from the filename on upload (a file named
`..._ROOM_ARRANGEMENT_...` lands as a manifest) — you can override it before
saving.

## How security works here

The publishable key is public — that's how Supabase is designed. Protection
comes from Row Level Security, enabled on all seven tables.

- Every table requires an authenticated session with an **active** profile
- Reference and ledger writes need `clerk` or above; deletes need `manager`
- **Payments are append-only** — no update or delete policy exists, so the
  audit trail cannot be quietly rewritten
- Helper functions are revoked from `anon` and `authenticated`, so they
  can't be called as REST endpoints
- Views use `security_invoker`, so they inherit the caller's permissions
  rather than bypassing them

Worth doing beyond this: enable MFA under Authentication, and check
**Database → Backups** (Pro gives you 7-day point-in-time recovery).

## Files

| File | Purpose |
|---|---|
| `index.html` | Login and app shell |
| `app.js` | Application logic |
| `config.js` | Supabase URL and key — already filled in |
| `schema.sql` | Full schema, for reference or rebuilding |
