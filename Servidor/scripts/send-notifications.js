const { sendRegionNotifications } = require("../src/notifications");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const summary = await sendRegionNotifications();

  console.log(JSON.stringify(summary, null, 2));
}
