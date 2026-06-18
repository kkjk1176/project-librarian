const { sampleAccountHandler } = require("./accounts");
const { sampleHealthHandler, sampleReadyHandler } = require("./server");

function registerAccountRoutes(app) {
  app.get("/sample/accounts/:id", sampleAccountHandler);
  app.get("/sample/healthz", sampleHealthHandler);
  app.get("/sample/readyz", sampleReadyHandler);
}

module.exports = { registerAccountRoutes };
