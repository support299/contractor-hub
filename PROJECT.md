# Clean on the Go Hub — Project Overview

Reference doc for migrating the Lovable/Supabase app in `lovable/` to **Django REST Framework + React**. Source left untouched; this file is analysis only.

---

## What the application does

**Clean on the Go Hub** is an internal ops hub for a cleaning company. Admins manage staff, payroll, time off, training materials, documents, and custom forms. Much of the business data (payroll, leave, reviews, bonuses, efficiency) is stored as **form submissions** rather than dedicated domain tables.

Current stack: **TanStack Start** (React 19 + Vite) + **Supabase** (Postgres, Storage, Realtime). UI is admin-first; `/` redirects to `/admin/dashboard`. Public form fill-out lives at `/forms/:slug`.

---

## User roles

Stored on `hub_users.role`:

| Role | Intended use |
|------|----------------|
| `admin` | Full hub access (settings, records, approvals, imports) |
| `employee` | Staff member; rates, sectors, payroll attribution |
| `contractor` | External contractor; same profile shape as employees |

Also on users: `status` (`active` / `inactive`), `position` (e.g. Team Leader, Cleaning Technician, Sub Contractor), `sectors[]`, pay rates (`regular_rate`, `drive_time_rate`, `fc_rate`, `tr_rate`, `supplies_deduction`), and external IDs (`jobber_id`, `ghl_id`).

**Note:** Role types and session helpers exist in code, but the shipped UI is effectively **open admin** — no login gate on `/admin/*`. Employee/contractor portals are not implemented as separate apps yet.

---

## Main features

### Admin (`/admin/*`)

| Area | Route | Purpose |
|------|--------|---------|
| Dashboard | `/admin/dashboard` | Per-staff metrics from form data: earnings, bonuses, star ratings, efficiency, client feedback |
| Payrolls | `/admin/payrolls` | Browse/filter payroll submissions; CSV import; create via form dialog |
| Calendar | `/admin/calendar` | Leave requests + absences; approve/reject leave |
| Resources | `/admin/resources` | Training videos (YouTube/Vimeo URLs) + document library |
| Records | `/admin/data` | Generic submissions browser: filter, edit, extra columns, leave approval status |
| Settings | `/admin/settings` | Users CRUD, alerts, form builder |
| Forms | `/admin/forms`, `/admin/forms/:id/submissions` | Manage forms and view submissions |

### Public

- **`/forms/:slug`** — fill and submit any active form (conditional fields, file upload, user/payroll pickers).

### Form-driven domain (important)

Hardcoded form slugs power features:

| Slug | Used for |
|------|----------|
| `new-payroll-records` | Payroll line items / earnings calc |
| `new-payroll-periods` | Open payroll periods (import + picker) |
| `request-time-off` | Leave requests + `hub_leave_approvals` |
| `new-absence` | Absence logging on calendar |
| `bonus-submissions` | Bonus totals on dashboard |
| `new-efficiency` | Efficiency % on dashboard |
| `review-your-recent-experience`, `how-are-we-doing` | Client reviews / ratings |

Payroll CSV import maps timesheet rows (regular / drive time / first clean / TR) onto users and payroll form fields.

---

## Database tables and purpose

All under Supabase `public`. RLS is enabled but policies are broadly open (`USING (true)` / anon write on most tables).

| Table | Purpose |
|-------|---------|
| `hub_users` | Staff/contractor/admin profiles, rates, sectors, Jobber/GHL IDs |
| `hub_forms` | Form definitions: name, slug, status, `fields` + `extra_fields` (JSON) |
| `hub_form_submissions` | Answers JSON keyed by field id; FK → `hub_forms` |
| `hub_leave_approvals` | 1:1 with leave submission; `pending` / `approved` / `rejected` |
| `hub_training_materials` | Training catalog (title, category, description, `video_url`) |
| `hub_documents` | Document metadata; file in Storage (`file_path`, size, type) |
| `hub_alerts` | Banner messages (`active`, `sort_order`) |

**Storage buckets**

| Bucket | Purpose |
|--------|---------|
| `form-uploads` | Public form file fields |
| `hub-documents` | Resources document files |

Realtime used on `hub_users`, `hub_forms`, `hub_alerts`, and `hub_leave_approvals`.

There is **no** separate payroll/leave/review schema — those domains are forms + JSON answers (+ leave approvals table).

---

## External integrations

| Integration | Status in code |
|-------------|----------------|
| **Supabase** | Primary backend: DB, Storage, Realtime, Auth client scaffolding |
| **Jobber** | `jobber_id` on users only — no Jobber API calls |
| **GoHighLevel (GHL)** | `ghl_id` on users only — no GHL API calls |
| **YouTube / Vimeo** | Thumbnail helpers for training videos (no API keys) |
| **CSV payroll import** | Client-side parse → form submissions (Jobber-style timesheet shape) |
| **Lovable / Cloudflare R2** | Hosting, OG preview assets, error reporting helpers |

No Stripe, email, SMS, or Edge Functions in use. Server fn example (`getGreeting`) is a stub only.

---

## Current authentication flow

**What runs today**

1. Browser talks to Supabase with the **anon/publishable** key.
2. Admin and public form routes call Supabase **directly from the client** — no app-level auth check.
3. RLS allows broad read/write; security is effectively “know the URL + anon key.”
4. Supabase Auth session plumbing exists (`client` persistSession, `attachSupabaseAuth` bearer on TanStack server fns, `requireSupabaseAuth` middleware) but **app features do not use it** for login or authorization.

**What was prepared but not wired**

In `hub-store.ts`:

- Session object `{ userId, role, identifier }` in `localStorage` (`cotg.session`)
- `findUser(email|phone, role)`
- Shared OTP constant `DEFAULT_OTP = "201095"`

No route or UI calls these. OTP login is scaffolding only.

**Implication for migration:** treat current auth as **placeholder**. Django should introduce real auth (sessions/JWT), role-based permissions, and lock down admin vs public form endpoints. Do not copy open RLS as-is.

---

## Overall migration strategy (Django + React)

Keep `lovable/` as the behavior reference. Rebuild deliberately; do not 1:1-port TanStack Start or open RLS.

### 1. Backend (Django + DRF)

- Models mirroring the seven tables above (JSONField for form fields/answers).
- File storage for the two buckets (S3/compatible or local→S3).
- Auth: Django users linked to hub profiles; roles `admin` / `employee` / `contractor`.
- Permissions: admin APIs authenticated; public form submit endpoints limited (active forms only).
- Domain APIs: users, forms, submissions, leave approvals, resources, alerts, payroll import.
- Preserve critical form slugs and field-label conventions used by dashboard/payroll/calendar (or introduce explicit domain models later).

### 2. Frontend (React)

- New React SPA (Vite or similar) consuming DRF.
- Replicate admin nav and flows first: Dashboard → Payrolls → Calendar → Resources → Records → Settings/Forms.
- Keep public `/forms/:slug` as a separate unauthenticated surface.
- Reuse UX patterns from Lovable; avoid porting Supabase client stores as the long-term data layer.

### 3. Suggested order

1. Schema + auth + users  
2. Forms + submissions + file upload  
3. Leave approvals + calendar  
4. Payroll list + CSV import  
5. Dashboard aggregations  
6. Resources + alerts  
7. Harden roles (employee/contractor views if required)  
8. Data migration from Supabase → Django DB + files  

### 4. Data migration notes

- Export Postgres tables; map UUIDs 1:1 where possible.
- Copy Storage objects into Django storage; rewrite paths if needed.
- Validate seeded forms match expected slugs before cutting over payroll/dashboard.
- Replace anon-wide access with proper permissions during cutover.

### 5. Out of scope unless requested later

- Live Jobber/GHL sync (IDs only today)
- Employee self-service portal beyond public forms
- Realtime websockets (poll or add later)

---

## Quick verification checklist

Before migration work starts, confirm with stakeholders:

- [ ] Admin-only product for now, or employee/contractor login needed day one?
- [ ] Keep form-centric architecture, or normalize payroll/leave into first-class models?
- [ ] Must preserve existing Supabase data and form slugs?
- [ ] Jobber/GHL IDs remain manual fields only?
- [ ] Shared OTP / email-phone login desired, or standard password/SSO?

---

*Source: `lovable/` (TanStack Start + Supabase migrations + routes/stores). Generated for migration planning; no application code changed.*
