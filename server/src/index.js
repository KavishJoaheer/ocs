const express = require("express");
const cors = require("cors");
const { initializeDatabase } = require("./db");
const dashboardRouter = require("./routes/dashboard");
const patientsRouter = require("./routes/patients");
const doctorsRouter = require("./routes/doctors");
const appointmentsRouter = require("./routes/appointments");
const consultationsRouter = require("./routes/consultations");
const billingRouter = require("./routes/billing");

initializeDatabase();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const configuredOrigins = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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
  res.json({ ok: true });
});

app.use("/api/dashboard", dashboardRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/doctors", doctorsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/consultations", consultationsRouter);
app.use("/api/billing", billingRouter);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`Clinic management API running on http://localhost:${PORT}`);
});
