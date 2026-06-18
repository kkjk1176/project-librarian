const { sampleHealthHandler } = require("../src/server");

function createResponse() {
  return { body: null, json(value) { this.body = value; } };
}

module.exports = { createResponse, sampleHealthHandler };
