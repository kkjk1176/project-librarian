function findSampleAccount(id) {
  return { id, status: "active" };
}

function sampleAccountHandler(req, res) {
  res.json(findSampleAccount(req.params.id));
}

module.exports = { findSampleAccount, sampleAccountHandler };
