const { buildClimateReport } = require("./report-builder");
const { upsertLatestReport } = require("./supabase");

async function generateAndStoreReport(options = {}) {
  const report = await buildClimateReport();

  if (options.store === false) {
    return {
      report,
      stored: null
    };
  }

  const stored = await upsertLatestReport(report);

  return {
    report,
    stored
  };
}

module.exports = {
  generateAndStoreReport
};
