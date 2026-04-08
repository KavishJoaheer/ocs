# ClinicFlow

ClinicFlow is a full-stack clinic management application built with React, Vite, Node.js, Express, and SQLite. It is designed for a small clinic that needs a clean workspace for patient records, appointments, consultation notes, billing, and doctor management.

## Features

- Dashboard with total patients, today’s appointments, pending bills, revenue, upcoming visits, and recent activity
- Patient directory with search, pagination, add/edit flows, and full patient profile pages
- Appointment management with doctor/status filters, calendar view, list view, and status updates
- Consultation notes linked to appointments with automatic bill creation
- Billing management with editable line items, payment tracking, and per-patient summaries
- Doctor management with add, edit, and delete protection for linked records
- SQLite database auto-created on first server start
- Seed data on first run:
  - 3 doctors
  - 2 patients
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

### Frontend

- Production frontend is deployed on Vercel
- Vercel config lives in [vercel.json](/C:/Users/kavis/OneDrive/Desktop/varun/vercel.json)

### Backend

- Local backend development still uses SQLite through [server/src/app.js](/C:/Users/kavis/OneDrive/Desktop/varun/server/src/app.js)
- Vercel-hosted backend entrypoint lives in [api/index.js](/C:/Users/kavis/OneDrive/Desktop/varun/api/index.js)
- [vercel.json](/C:/Users/kavis/OneDrive/Desktop/varun/vercel.json) rewrites `/api/*` requests into that single Vercel Function to stay within the Hobby plan limits
- Vercel backend behavior:
  - If `DATABASE_URL`, `POSTGRES_URL`, or `POSTGRES_PRISMA_URL` is set, the API uses PostgreSQL through [server/src/pg.js](/C:/Users/kavis/OneDrive/Desktop/varun/server/src/pg.js)
  - Otherwise it falls back to a temporary SQLite file on Vercel for demo use only
- Docker deployment is still available through [Dockerfile](/C:/Users/kavis/OneDrive/Desktop/varun/Dockerfile)
- The server respects `PORT`
- Optional CORS control:
  - `CLIENT_ORIGIN=https://your-frontend-domain`
  - or `CLIENT_ORIGINS=https://site-one.com,https://site-two.com`

## API Notes

The backend exposes a JSON REST API under `/api`, including:

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
