const { URL } = require("node:url");

const { hasPostgresConfig } = require("../server/src/pg");
const { createApp } = require("../server/src/app");
const { createPostgresApp } = require("../server/src/vercel-postgres-app");

const app = hasPostgresConfig ? createPostgresApp() : createApp();

module.exports = (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  const routeParam = requestUrl.searchParams.get("route");

  if (routeParam !== null) {
    requestUrl.searchParams.delete("route");
    const normalizedRoute = routeParam ? `/api/${routeParam}` : "/api";
    const search = requestUrl.searchParams.toString();

    req.url = `${normalizedRoute}${search ? `?${search}` : ""}`;
  }

  return app(req, res);
};
