const { generateAndStoreReport } = require("../src/pipeline");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const result = await generateAndStoreReport();
  const summary = result.report.summary || {};

  console.log(JSON.stringify({
    ok: true,
    reportKey: result.report.reportKey,
    generatedAt: result.report.generatedAt,
    totalAlerts: summary.totalAlerts || 0,
    statesAffected: summary.statesAffected || 0,
    stationsSampled: summary.stationsSampled || 0,
    newsItems: summary.newsItems || 0
  }, null, 2));
}
