const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { initializeDatabase } = require("./db");
const authRouter = require("./routes/auth");
const dashboardRouter = require("./routes/dashboard");
const operatorRouter = require("./routes/operator");
const hcmNewsRouter = require("./routes/hcmNews");
const patientsRouter = require("./routes/patients");
const doctorsRouter = require("./routes/doctors");
const teamOperationsRouter = require("./routes/teamOperations");
const appointmentsRouter = require("./routes/appointments");
const consultationsRouter = require("./routes/consultations");
const billingRouter = require("./routes/billing");
const inventoryRouter = require("./routes/inventory");
const labReportsRouter = require("./routes/labReports");
const pushRouter = require("./routes/push");
const { authorizeByMethod, authorizeRoles, requireAuth, requireAuthFlexible } = require("./lib/auth");
const { withClientSessionContext } = require("./lib/inventoryRealtime");

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

function isProductionEnv() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function createApp() {
  if (!initialized) {
    initializeDatabase();
    initialized = true;
  }

  const configuredOrigins = getAllowedOrigins();
  const productionMode = isProductionEnv();

  // Refuse to boot in production without an explicit allow-list. The previous
  // behaviour (empty list → allow everything) would silently expose the API
  // to any origin once deployed behind a public tunnel/CDN.
  if (productionMode && configuredOrigins.length === 0) {
    throw new Error(
      "CLIENT_ORIGINS (or CLIENT_ORIGIN) must be set in production. " +
        "Refusing to start with an open CORS allow-list.",
    );
  }

  const app = express();

  // Behind Cloudflare/Tunnel/NAS reverse proxies the real client IP arrives
  // in X-Forwarded-For. Trust the first hop so rate limiting and logging
  // record the real IP instead of the loopback proxy address.
  app.set("trust proxy", 1);

  // Baseline security headers. CSP and COEP are disabled because the SPA
  // bundle ships inline runtime, registers a service worker, and loads
  // cross-origin push manager + EventSource — all of which need a tailored
  // CSP that the SPA can opt into later.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          // Same-origin / curl / mobile WebView with no Origin header.
          callback(null, true);
          return;
        }
        if (configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  // Capture the per-tab X-Client-Session-Id into an async-local store so deep
  // helpers (inventory writes, billing decrements) can fan SSE updates to
  // every device except the originating tab without threading the id through
  // every call site.
  app.use(withClientSessionContext);

  // Defensive throttles. Defaults are deliberately conservative so a
  // mistyped script can't brute-force credentials or hammer the SQLite DB.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many login attempts. Please try again in a few minutes." },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 600),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and retry." },
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      mode: "sqlite",
      database: process.env.DB_PATH || "server/data/clinic.db",
      features: {
        billing: true,
        inventory: true,
        consultations: true,
        push: true,
        realtime: true,
      },
    });
  });

  // Apply the API throttle before any router so it covers public push +
  // auth endpoints too. Login attempts get an additional, stricter limiter.
  app.use("/api", apiLimiter);
  app.use("/api/auth/login", loginLimiter);

  app.use("/api/auth", authRouter);
  app.use("/api/push", pushRouter);
  app.use(
    "/api/dashboard",
    requireAuth,
    authorizeRoles("admin", "doctor", "operator", "lab_tech", "accountant"),
    dashboardRouter,
  );
  app.use("/api/v1/operator", requireAuth, authorizeRoles("operator"), operatorRouter);
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
      GET: ["admin", "doctor", "operator", "lab_tech", "accountant"],
      POST: ["admin", "doctor"],
      PUT: ["admin", "doctor", "operator"],
      PATCH: ["admin", "operator"],
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
      GET: ["admin", "doctor", "lab_tech", "accountant"],
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
      POST: ["admin", "accountant", "doctor"],
      PUT: ["admin", "accountant", "doctor"],
      PATCH: ["admin", "accountant", "doctor"],
    }),
    billingRouter,
  );
  app.use(
    "/api/lab-reports",
    requireAuth,
    authorizeByMethod({
      GET: ["admin", "doctor", "operator", "lab_tech", "accountant"],
      POST: ["admin", "doctor", "lab_tech"],
      PUT: ["admin", "doctor", "lab_tech"],
      DELETE: ["admin"],
    }),
    labReportsRouter,
  );

  app.use(
    "/api/inventory",
    requireAuthFlexible,
    authorizeRoles("admin", "doctor", "operator"),
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

  app.use((error, req, res, _next) => {
    console.error(`[error] ${req?.method || "?"} ${req?.originalUrl || "?"}:`, error);

    if (error?.name === "MulterError") {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Each uploaded file must be 10 MB or smaller." });
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({ error: "You can upload up to 5 files per report." });
      }
    }

    if (error?.message === "Only PDF and image files are allowed.") {
      return res.status(400).json({ error: error.message });
    }

    if (error?.message === "Only PDF roster uploads are allowed.") {
      return res.status(400).json({ error: error.message });
    }

    const detail = error?.message ? String(error.message).slice(0, 500) : "";
    res.status(500).json({
      error: detail ? `Server error: ${detail}` : "Unexpected server error.",
    });
  });

  return app;
}

module.exports = {
  createApp,
};
