import { createServer } from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { logger, childLogger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { sseHub } from "./realtime/sse.js";
import { startJobs } from "./jobs/scheduler.js";
import { verifyMailTransport } from "./notifications/mailer.js";

const log = childLogger("bootstrap");

async function main(): Promise<void> {
  const app = createApp();
  const server = createServer(app);

  // Slowloris protection: cap how long a client may take to send headers.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
  server.maxRequestsPerSocket = 1000;

  // Track open sockets so that the graceful shutdown can force-close them.
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, env.HOST, () => {
      log.info(
        { port: env.PORT, host: env.HOST, env: env.NODE_ENV },
        `SeniorCare API listening on http://${env.HOST}:${env.PORT}${env.API_PREFIX}`,
      );
      resolve();
    });
  });

  startJobs();

  if (env.MAIL_ENABLED) {
    const mailOk = await verifyMailTransport();
    if (!mailOk) {
      log.error("the SMTP endpoint could not be verified — e-mail alerts will fail");
    }
  } else {
    log.warn("MAIL_ENABLED=false — e-mail notifications are logged instead of sent");
  }

  // --- Graceful shutdown ---------------------------------------------------
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");

    const forceExit = setTimeout(() => {
      log.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 15_000);
    forceExit.unref();

    // 1. Stop accepting new connections.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    // 2. Close the long-lived SSE streams.
    sseHub.closeAll();

    // 3. Close idle keep-alive sockets.
    for (const socket of sockets) {
      socket.destroy();
    }

    // 4. Release the database pool.
    await prisma.$disconnect();

    clearTimeout(forceExit);
    log.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "uncaught exception — shutting down");
    void shutdown("uncaughtException");
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, "failed to start the server");
  process.exit(1);
});
