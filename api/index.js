const { hasPostgresConfig } = require("../server/src/pg");
const { createApp } = require("../server/src/app");
const { createPostgresApp } = require("../server/src/vercel-postgres-app");

module.exports = hasPostgresConfig ? createPostgresApp() : createApp();
