const { existsSync } = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const gatewayPath = path.resolve(__dirname, "..", "dist", "src", "gateway.js");
const waitMs = Number(process.env.PROJECT_MEMORY_PM2_GATEWAY_WAIT_MS ?? 30000);
const pollMs = 250;

async function waitForGateway() {
  const deadline = Date.now() + waitMs;

  while (!existsSync(gatewayPath)) {
    if (Date.now() > deadline) {
      throw new Error(`Gateway build output not found: ${gatewayPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return gatewayPath;
}

waitForGateway()
  .then((filePath) => import(pathToFileURL(filePath).href))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
