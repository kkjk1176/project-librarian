function requireSampleTenant(req, res, next) {
  req.sampleTenant = req.headers["x-sample-tenant"] || "default";
  next();
}

module.exports = { requireSampleTenant };
