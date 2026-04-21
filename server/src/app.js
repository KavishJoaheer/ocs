const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { initializeDatabase } = require("./db");
const authRouter = require("./routes/auth");
const dashboardRouter = require("./routes/dashboard");
const hcmNewsRouter = require("./routes/hcmNews");
const patientsRouter = require("./routes/patients");
const doctorsRouter = require("./routes/doctors");
const teamOperationsRouter = require("./routes/teamOperations");
const appointmentsRouter = require("./routes/appointments");
const consultationsRouter = require("./routes/consultations");
const billingRouter = require("./routes/billing");
const inventoryRouter = require("./routes/inventory");
const labReportsRouter = require("./routes/labReports");
const { authorizeByMethod, authorizeRoles, requireAuth } = require("./lib/auth");

let initialized = false;

function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getClientDistPath() {
  return process.env.CLIENT_DIST_PATH
    ? path.resolve(process.env.CLIENT_DIST_PATH)
    : path.resolve(__dirname, "../../client/dist");
}

function createApp() {
  if (!initialized) {
    initializeDatabase();
    initialized = true;
  }

  const configuredOrigins = getAllowedOrigins();
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: "sqlite" });
  });

  app.use("/api/auth", authRouter);
  app.use(
    "/api/dashboard",
    requireAuth,
    authorizeRoles("admin", "doctor", "operator", "lab_tech", "accountant"),
    dashboardRouter,
  );
  app.use(
    "/api/hcm-news",
    requireAuth,
    authorizeRoles("admin", "doctor", "operator", "lab_tech", "accountant"),
    hcmNewsRouter,
  );
  app.use(
    "/api/patients",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "doctor", "operator", "lab_tech"],
      POST: ["admin", "doctor", "operator"],
      PUT: ["admin", "doctor", "operator"],
      DELETE: ["admin"],
    }),
    patientsRouter,
  );
  app.use(
    "/api/doctors",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "doctor", "operator"],
      POST: ["admin"],
      PUT: ["admin"],
      DELETE: ["admin"],
    }),
    doctorsRouter,
  );
  app.use(
    "/api/team-operations",
    requireAuth,
    authorizeRoles("admin"),
    teamOperationsRouter,
  );
  app.use(
    "/api/appointments",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "doctor"],
      POST: ["admin"],
      PUT: ["admin"],
      PATCH: ["admin", "doctor"],
      DELETE: ["admin"],
    }),
    appointmentsRouter,
  );
  app.use(
    "/api/consultations",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "doctor", "lab_tech"],
      POST: ["admin", "doctor"],
      PUT: ["admin", "doctor"],
      DELETE: ["admin"],
    }),
    consultationsRouter,
  );
  app.use(
    "/api/billing",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "accountant", "doctor", "operator"],
      POST: ["admin", "doctor"],
      PUT: ["admin", "accountant", "doctor"],
      PATCH: ["admin", "accountant", "doctor"],
    }),
    billingRouter,
  );
  app.use(
    "/api/lab-reports",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "doctor", "operator", "lab_tech"],
      POST: ["admin", "doctor", "lab_tech"],
      PUT: ["admin", "doctor", "lab_tech"],
    }),
    labReportsRouter,
  );

  app.use(
    "/api/inventory",
    requireAuth,
    authorizeRoles("admin", "doctor", "lab_tech"),
    inventoryRouter,
  );

  const clientDistPath = getClientDistPath();
  const clientIndexPath = path.join(clientDistPath, "index.html");

  if (fs.existsSync(clientIndexPath)) {
    app.use(express.static(clientDistPath));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(clientIndexPath);
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}

module.exports = {
  createApp,
};
