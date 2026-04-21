const { createApp } = require("./app");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3001;
const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Clinic management API running on http://${HOST}:${PORT}`);
});
