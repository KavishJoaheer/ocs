# ClinicFlow

ClinicFlow is a full-stack clinic management application built with React, Vite, Node.js, Express, and SQLite. It is designed for a small clinic that needs a clean workspace for patient records, appointments, consultation notes, billing, and doctor management.

## Features

- Dashboard with total patients, today’s appointments, pending bills, revenue, upcoming visits, and recent activity
- Patient directory with search, pagination, add/edit flows, and full patient profile pages
- Appointment management with doctor/status filters, calendar view, list view, and status updates
- Consultation notes linked to appointments with automatic bill creation
- Billing management with editable line items, payment tracking, and per-patient summaries
- Doctor management with add, edit, and delete protection for linked records
- Role-based login with seeded accounts for doctors, operators, lab staff, and accounting
- SQLite database auto-created on first server start
- Seed data on first run:
  - 10 doctors
  - 2 patients
  - 15 user accounts
  - a few sample appointments, consultations, and bills for easier testing

## Tech Stack

- Frontend: React + Vite + React Router + Tailwind CSS
- Backend: Node.js + Express
- Database: SQLite via `better-sqlite3`
- Dev runner: `concurrently`

## Project Structure

```text
.
├── client/   # React + Vite frontend
├── server/   # Express API + SQLite initialization
└── package.json
```

## Ports

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Setup

Install dependencies in the root and both workspaces:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

Start both apps together from the repository root:

```bash
npm run dev
```

## Seeded Login Accounts

All seeded users share the same starter password:

```text
Welcome@123
```

Available accounts:

- Doctors: `doctor01` through `doctor10`
- Operators: `operator01`, `operator02`, `operator03`
- Lab tech: `labtech01`
- Accountant: `accountant01`

## Role Access

- `doctor`: dashboard, patients, appointments, consultations
- `operator`: dashboard, patients, appointments, doctors
- `lab_tech`: dashboard, patients, consultations, lab workspace
- `accountant`: dashboard, billing

## Individual Scripts

From the repo root:

- `npm run dev` starts frontend and backend together
- `npm run dev:client` starts only the Vite frontend
- `npm run dev:server` starts only the Express backend
- `npm run build` builds the frontend for production
- `npm run start` starts the backend in production mode

## Database

- Database file: `server/data/clinic.db`
- The database is created automatically when the backend starts for the first time
- Schema creation and seed logic live in [server/src/db.js](/C:/Users/kavis/OneDrive/Desktop/varun/server/src/db.js)

## Deployment Notes

### Recommended: Docker + SQLite (full billing & inventory)

Production clinic operations should run the **full Express app** with a **persistent SQLite** database in Docker:

- Guide: [docs/NAS_SQLITE_PRODUCTION.md](docs/NAS_SQLITE_PRODUCTION.md)
- NAS / UGOS steps: [NAS_DEPLOYMENT.md](NAS_DEPLOYMENT.md)
- Docker Hub publish: [docs/PHASE1_DOCKER_HUB.md](docs/PHASE1_DOCKER_HUB.md)

```bash
cp .env.example .env
npm run deploy:nas         # build & run (requires Docker running)
npm run docker:health      # verify sqlite + inventory
```

One-page checklist: [DEPLOY.md](DEPLOY.md)

Data is stored in volume `clinicflow-data` at `/data/clinic.db` (plus attachments under `/data/`).

### Optional: Vercel frontend only

Host the React UI on Vercel and point it at your NAS API with `VITE_API_BASE=https://your-host/api`. Use [vercel.static.json](vercel.static.json) (no serverless API). Set `CLIENT_ORIGINS` on the Docker container for CORS.

### Not recommended for production clinic ops

- Vercel serverless API + Postgres (`USE_POSTGRES=true`) — billing only, no inventory sync
- Vercel serverless without Postgres — ephemeral SQLite in `/tmp`

### Environment

- `PORT`, `HOST`, `DB_PATH` (Docker sets `DB_PATH=/data/clinic.db`)
- `CLIENT_ORIGIN` or `CLIENT_ORIGINS` for CORS when UI and API are on different hosts
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` for push notifications (or auto-generated in `/data/vapid.json`)

## API Notes

The backend exposes a JSON REST API under `/api`, including:

- `/api/auth/login`
- `/api/auth/me`
- `/api/auth/logout`
- `/api/dashboard`
- `/api/patients`
- `/api/doctors`
- `/api/appointments`
- `/api/consultations`
- `/api/billing`

## Verification

The project was verified with:

- `npm run build` in [client/package.json](/C:/Users/kavis/OneDrive/Desktop/varun/client/package.json)
- backend smoke tests against `/api/health`, `/api/dashboard`, `/api/patients`, `/api/appointments`, `/api/consultations`, `/api/billing`, and `/api/doctors`
