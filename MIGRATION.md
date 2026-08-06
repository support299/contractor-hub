# Clean on the Go Hub — Migration Runbook

Manual steps for local setup, deployment, and data import. Keep this file updated as the migration progresses.

---

## Status

| Milestone | Status |
|-----------|--------|
| Django backend (models, APIs, JWT, admin) | **Done** |
| React Vite frontend consuming Django APIs | **Done** |
| `import_supabase` management command | **Done** |
| S3 media storage support | **Done** |

`lovable/` is untouched (reference only).

---

## Backend setup (local)

```powershell
cd D:\Work\Saasyway\peter\contractor-hub\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # edit secrets
python manage.py migrate
python manage.py create_hub_admin --email admin@cotg.local --password admin123 --name "Hub Admin"
python manage.py runserver 8000
```

- API base: `http://127.0.0.1:8000/api/`
- Swagger: `http://127.0.0.1:8000/api/docs/`
- Django admin: `http://127.0.0.1:8000/admin/`
- Media (local): `http://127.0.0.1:8000/media/...`

### Environment variables (`backend/.env`)

| Variable | Purpose | Example |
|----------|---------|---------|
| `DJANGO_SECRET_KEY` | Django secret | long random string |
| `DJANGO_DEBUG` | Debug mode | `True` locally |
| `DJANGO_ALLOWED_HOSTS` | Host allowlist | `localhost,127.0.0.1` |
| `CORS_ALLOWED_ORIGINS` | Frontend origins | `http://localhost:5173` |
| `DATABASE_URL` | Empty = SQLite; or Postgres URL | `postgres://user:pass@localhost:5432/contractor_hub` |
| `MEDIA_ROOT` | Local uploads root (ignored when `USE_S3=True`) | leave empty for `backend/media` |
| `DEFAULT_OTP` | OTP for hub login (Lovable parity) | `201095` |
| `JWT_ACCESS_MINUTES` | Access token lifetime | `60` |
| `JWT_REFRESH_DAYS` | Refresh token lifetime | `7` |
| `USE_S3` | Store media in S3 instead of disk | `False` local / `True` prod |
| `AWS_ACCESS_KEY_ID` | IAM access key | from IAM user |
| `AWS_SECRET_ACCESS_KEY` | IAM secret | from IAM user |
| `AWS_STORAGE_BUCKET_NAME` | S3 bucket name | `cotg-hub-media` |
| `AWS_S3_REGION_NAME` | Bucket region | `us-east-1` |
| `AWS_S3_CUSTOM_DOMAIN` | Optional CloudFront domain | leave empty initially |
| `AWS_QUERYSTRING_EXPIRE` | Signed URL lifetime (seconds) | `3600` |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | Max request body (bytes) | `314572800` (~300MB) |

### Auth

- **Password login:** `POST /api/auth/login/` `{ "username", "password" }` → JWT  
  Seed: `admin@cotg.local` / `admin123` (username = email)
- **OTP login:** `POST /api/auth/otp-login/` `{ "identifier", "role", "otp" }` → JWT  
- **Refresh:** `POST /api/auth/refresh/` `{ "refresh" }`
- **Me:** `GET /api/auth/me/`

Admin UI requires JWT. Public: `/forms/:slug`, active form reads, form submit, alerts list, form-uploads.

### API map

| Resource | Endpoints |
|----------|-----------|
| Users | `/api/users/`, `/api/users/sectors/` |
| Forms | `/api/forms/`, `/api/forms/by-slug/{slug}/` |
| Submissions | `/api/submissions/?form=`, `/api/submissions/open-payrolls/` |
| Leave | `/api/leave-approvals/`, `/api/leave-approvals/ensure/` |
| Training | `/api/training/` (`?position=`) |
| Documents | `/api/documents/` (`?position=`) |
| Resource folders | `/api/resource-folders/` |
| Alerts | `/api/alerts/`, `/api/alerts/active/` |
| Uploads | `POST /api/uploads/`, `GET /api/uploads/url/?path=`, `POST /api/uploads/delete/` |

Leave submissions for slug `request-time-off` auto-create pending approval.

---

## Frontend setup (local)

```powershell
cd D:\Work\Saasyway\peter\contractor-hub\frontend
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:5173` → redirects to login → `/admin/dashboard`.

### Frontend env

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Django API base, default `http://127.0.0.1:8000/api` |

Vite also proxies `/api` and `/media` to `:8000` in `vite.config.ts`.

### Routes (parity with Lovable)

| Path | Access |
|------|--------|
| `/login` | Public |
| `/admin/dashboard` | JWT admin |
| `/admin/payrolls` | JWT admin |
| `/admin/calendar` | JWT admin |
| `/admin/resources` | JWT admin |
| `/admin/data` | JWT admin |
| `/admin/settings` | JWT admin |
| `/admin/forms` | JWT admin |
| `/admin/forms/:formId/submissions` | JWT admin |
| `/forms/:slug` | Public |

Optional: place a logo at `frontend/public/logo.png` (falls back to text brand).

---

## Supabase data export / import

### 1. Export tables (Supabase SQL editor or CLI)

Export each table as JSON array of rows, named:

- `hub_users.json`
- `hub_forms.json`
- `hub_form_submissions.json`
- `hub_leave_approvals.json`
- `hub_training_materials.json`
- `hub_documents.json`
- `hub_alerts.json`

Example folder:

```
export/
  hub_users.json
  hub_forms.json
  ...
  files/
    form-uploads/...
    hub-documents/...
```

### 2. Download Storage

From Supabase Storage buckets `form-uploads` and `hub-documents`, mirror objects under `export/files/<bucket>/...` so paths match `file_path` / upload keys.

**Important:** Lovable already has large files (e.g. ~220MB PDFs). Expect a big `files/` download. Prefer running import on EC2 with `USE_S3=True` so files go straight into the bucket (not EC2 disk).

### 3. Import

```powershell
cd D:\Work\Saasyway\peter\contractor-hub\backend
.\.venv\Scripts\Activate.ps1
python manage.py import_supabase --data-dir path\to\export
# destructive re-import:
python manage.py import_supabase --data-dir path\to\export --clear
# JSON only:
python manage.py import_supabase --data-dir path\to\export --skip-files
```

With `USE_S3=True` in `.env`, `files/` are uploaded to S3 under the same relative keys.

### 4. Verify

- Confirm form slugs exist: `new-payroll-records`, `new-payroll-periods`, `request-time-off`, `new-absence`, `bonus-submissions`, `new-efficiency`, `review-your-recent-experience`, `how-are-we-doing`
- Spot-check dashboard metrics, payroll list, calendar leave, resources files
- Open a large document from Resources and confirm the signed S3 URL works
- Re-run `create_hub_admin` if you cleared users and need a login again

---

## Production notes

- `DJANGO_DEBUG=False`, strong secret, real `ALLOWED_HOSTS` + CORS origins
- Postgres via `DATABASE_URL` (RDS)
- **Media on S3** (`USE_S3=True`) — required; Lovable has 200MB+ documents
- Static (Django admin CSS) via nginx on EC2; frontend `dist` on EC2
- `gunicorn config.wsgi:application`
- Build frontend: `npm run build` → copy `frontend/dist` to EC2
- Never commit `.env`, `db.sqlite3`, or secrets

---

## Deploy plan: GitHub → EC2 + RDS + S3

**Why S3:** Resources already include PDFs over **200MB** (e.g. Team Leader’s Handbook). Putting those on EC2 disk is slow, expensive to grow, and painful to back up. S3 stores objects; EC2 only runs the app.

Assumptions:

- Ubuntu EC2: **nginx** (frontend + reverse proxy) + **gunicorn** (Django)
- **RDS Postgres** for the database
- **S3 bucket** for all media (`form-uploads/`, `hub-documents/`)
- Frontend built on your PC; `dist/` copied to EC2

Replace placeholders:

| Placeholder | Meaning |
|-------------|---------|
| `YOUR_GITHUB_USER` | GitHub username/org |
| `contractor-hub` | Repo name |
| `EC2_IP` | Elastic IP or public IP |
| `ubuntu` | SSH user (Ubuntu AMI) |
| `your-key.pem` | EC2 key pair |
| `DB_HOST` | RDS endpoint |
| `DB_NAME` / `DB_USER` / `DB_PASS` | RDS credentials |
| `BUCKET` | S3 bucket name, e.g. `cotg-hub-media` |
| `REGION` | e.g. `us-east-1` |

---

### Phase A — Push code to GitHub (from your PC)

1. Create an empty private GitHub repo.

2. In PowerShell:

```powershell
cd D:\Work\Saasyway\peter\contractor-hub
git init
git add .
git status
# Confirm .env, db.sqlite3, .venv, node_modules, media are NOT staged
git commit -m "Initial Clean on the Go Hub Django + React migration"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USER/contractor-hub.git
git push -u origin main
```

3. Do **not** commit secrets.

---

### Phase B — Create RDS (Postgres)

1. AWS Console → **RDS** → Create database → **PostgreSQL**.
2. Set master username/password; save them.
3. Same **VPC** as the future EC2. Public access: **No**.
4. Security group `cotg-rds-sg`: inbound **TCP 5432 only from EC2 SG**.
5. Wait until Available; copy endpoint → `DB_HOST`.
6. Ensure DB name exists (create UI option or `CREATE DATABASE contractor_hub;`).

---

### Phase C — Create S3 bucket + IAM

1. AWS Console → **S3** → Create bucket.
2. Name: `BUCKET` (globally unique), Region: `REGION`.
3. Block Public Access: **keep ON** (app uses **pre-signed URLs**).
4. Default encryption: SSE-S3 (AES-256) is fine.
5. Optional: enable versioning if you want safer deletes.

6. **IAM** → Users → Create user `cotg-hub-s3` (or attach role to EC2 later — user keys are simplest to start).
7. Attach an inline policy (replace `BUCKET`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::BUCKET",
        "arn:aws:s3:::BUCKET/*"
      ]
    }
  ]
}
```

8. Create **Access key** for that user → save `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

9. (Optional later) CloudFront in front of the bucket → set `AWS_S3_CUSTOM_DOMAIN`.

**CORS on the bucket** (needed if the browser ever hits S3 URLs directly for uploads/downloads):

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedOrigins": ["http://EC2_IP", "https://your.domain.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

---

### Phase D — Create EC2

1. Launch Ubuntu 22.04, e.g. `t3.small`.
2. Same VPC as RDS. Attach Elastic IP.
3. Security group `cotg-ec2-sg`:

   | Type | Port | Source |
   |------|------|--------|
   | SSH | 22 | Your IP only |
   | HTTP | 80 | `0.0.0.0/0` |
   | HTTPS | 443 | `0.0.0.0/0` (after certbot) |

4. Disk: **20–30 GB** is enough now (media is on S3, not the instance).
5. Allow RDS SG inbound 5432 from this EC2 SG.
6. Outbound HTTPS from EC2 must reach S3 (default outbound OK).

---

### Phase E — First SSH + packages

```bash
ssh -i your-key.pem ubuntu@EC2_IP
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv nginx git postgresql-client
sudo mkdir -p /var/www/cotg
sudo chown ubuntu:ubuntu /var/www/cotg
```

---

### Phase F — Clone + install

```bash
cd /var/www/cotg
git clone https://github.com/YOUR_GITHUB_USER/contractor-hub.git
cd contractor-hub/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Private repo → deploy key / PAT, or `scp` the project.

---

### Phase G — Backend `.env` on EC2 (RDS + S3)

```bash
nano /var/www/cotg/contractor-hub/backend/.env
```

```env
DJANGO_SECRET_KEY=GENERATE_A_LONG_RANDOM_STRING
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=EC2_IP,your.domain.com
CORS_ALLOWED_ORIGINS=http://EC2_IP,https://your.domain.com
DATABASE_URL=postgres://DB_USER:DB_PASS@DB_HOST:5432/contractor_hub
DEFAULT_OTP=CHANGE_ME_OR_DISABLE
JWT_ACCESS_MINUTES=60
JWT_REFRESH_DAYS=7

# Large PDFs (handbook ~220MB)
DATA_UPLOAD_MAX_MEMORY_SIZE=314572800
FILE_UPLOAD_MAX_MEMORY_SIZE=10485760

# S3 media
USE_S3=True
AWS_ACCESS_KEY_ID=YOUR_KEY
AWS_SECRET_ACCESS_KEY=YOUR_SECRET
AWS_STORAGE_BUCKET_NAME=BUCKET
AWS_S3_REGION_NAME=REGION
AWS_S3_CUSTOM_DOMAIN=
AWS_QUERYSTRING_EXPIRE=3600
```

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

---

### Phase H — Migrate DB + admin

```bash
cd /var/www/cotg/contractor-hub/backend
source .venv/bin/activate
python manage.py migrate
python manage.py create_hub_admin --email you@company.com --password 'STRONG_PASSWORD' --name "Admin"
python manage.py collectstatic --noinput
```

---

### Phase I — Gunicorn systemd

```bash
sudo nano /etc/systemd/system/cotg.service
```

```ini
[Unit]
Description=Clean on the Go Hub (Gunicorn)
After=network.target

[Service]
User=ubuntu
Group=www-data
WorkingDirectory=/var/www/cotg/contractor-hub/backend
EnvironmentFile=/var/www/cotg/contractor-hub/backend/.env
ExecStart=/var/www/cotg/contractor-hub/backend/.venv/bin/gunicorn \
  --workers 3 \
  --timeout 300 \
  --bind 127.0.0.1:8000 \
  config.wsgi:application
Restart=always

[Install]
WantedBy=multi-user.target
```

`--timeout 300` helps large uploads proxy through the API to S3.

```bash
sudo systemctl daemon-reload
sudo systemctl enable cotg
sudo systemctl start cotg
sudo systemctl status cotg
```

---

### Phase J — Nginx (frontend + API; media via S3)

Media is **not** served from EC2 disk when `USE_S3=True`. `/api/uploads/url/` returns an S3 pre-signed URL. Nginx only needs a high upload body size so large files can reach Gunicorn.

```bash
sudo nano /etc/nginx/sites-available/cotg
```

```nginx
server {
    listen 80;
    server_name EC2_IP your.domain.com;

    # Allow ~300MB handbook uploads through the API → S3
    client_max_body_size 300M;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    root /var/www/cotg/frontend-dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8000/admin/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        alias /var/www/cotg/contractor-hub/backend/staticfiles/;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cotg /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

### Phase K — Build frontend locally → copy `dist`

```powershell
cd D:\Work\Saasyway\peter\contractor-hub\frontend
$env:VITE_API_URL="/api"
npm run build
ssh -i your-key.pem ubuntu@EC2_IP "mkdir -p /var/www/cotg/frontend-dist"
scp -i your-key.pem -r dist/* ubuntu@EC2_IP:/var/www/cotg/frontend-dist/
```

Open `http://EC2_IP` → login.

---

### Phase L — Import Supabase data into RDS + S3

Do this **on EC2** with `USE_S3=True` already set.

1. Export JSON + download Supabase Storage into `export/files/...` on your PC.
2. Upload export to EC2 (this can be large — use a stable connection):

```powershell
scp -i your-key.pem -r path\to\export ubuntu@EC2_IP:/home/ubuntu/supabase-export
```

3. On EC2:

```bash
cd /var/www/cotg/contractor-hub/backend
source .venv/bin/activate
python manage.py import_supabase --data-dir /home/ubuntu/supabase-export
```

JSON → RDS; `files/` → **S3** (same relative keys as `file_path`).

4. Verify form slugs + open the large handbook from Resources (should redirect to an S3 signed URL).
5. If you used `--clear`, recreate admin.

Alternative for huge trees: `aws s3 sync export/files/ s3://BUCKET/` from a machine with AWS CLI, then `import_supabase --skip-files` for DB-only.

---

### Phase M — HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.com
```

Update `.env` `DJANGO_ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS` to `https://your.domain.com`, update S3 CORS AllowedOrigins, then:

```bash
sudo systemctl restart cotg
sudo systemctl reload nginx
```

---

### Phase N — Smoke test

- [ ] Login works  
- [ ] Admin pages load  
- [ ] Public form submits  
- [ ] Upload a small doc in Resources → appears in S3 console under `hub-documents/`  
- [ ] Open / download the ~220MB handbook (signed S3 URL)  
- [ ] `systemctl status cotg` / `nginx` active  

---

### Ongoing updates

**Backend:**

```bash
cd /var/www/cotg/contractor-hub && git pull
cd backend && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart cotg
```

**Frontend:** rebuild with `VITE_API_URL=/api`, `scp` `dist/*` to `/var/www/cotg/frontend-dist/`.

---

### Architecture (prod)

```
Browser
  ├─ static UI  → EC2 nginx (/var/www/cotg/frontend-dist)
  ├─ /api/*     → EC2 nginx → gunicorn (Django)
  └─ file bytes → S3 pre-signed URLs (from /api/uploads/url/)

Django  → RDS Postgres (data)
        → S3 (media)
```

---

## Resources (employee hub v2)

Admin Resources supports:

- **Folders** — categories as folders
- **Position visibility** — selected staff positions (empty = all)
- **Optional download** — `allow_download`
- **Copy protection** — soft UI deterrent (`allow_copy`)

API: `GET /api/documents/?position=Team%20Leader` (same for `/api/training/`).

Import: old Supabase `category` strings → folders; new fields default safely.

---

## Do not touch

- `lovable/` — reference only; leave completely unchanged.
