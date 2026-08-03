import app from "./server.js";
import { config } from "./config.js";
import { log } from "./logging.js";

const server = app.listen(config.port, "0.0.0.0", () => {
  log({ event: "server_started", port: config.port, max_concurrency: config.maxConcurrency });
});

function shutdown(signal: string): void {
  log({ event: "server_shutdown", signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
