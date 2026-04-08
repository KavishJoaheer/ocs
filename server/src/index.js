const { createApp } = require("./app");
const PORT = Number(process.env.PORT) || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Clinic management API running on http://localhost:${PORT}`);
});
