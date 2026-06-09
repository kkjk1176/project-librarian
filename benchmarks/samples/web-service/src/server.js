const express = require("express");

function sampleHealthHandler(req, res) {
  res.json({ ok: true });
}

function sampleReadyHandler(req, res) {
  res.json({ ready: true });
}

function registerSampleRoutes(app) {
  app.get("/sample/health", sampleHealthHandler);
  app.get("/sample/ready", sampleReadyHandler);
}

module.exports = { registerSampleRoutes, sampleHealthHandler, sampleReadyHandler };
