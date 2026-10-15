import { createServer } from "node:http";
import { createApp } from "./app.js";
import { attachGameSockets } from "./games/socket.js";

async function main(): Promise<void> {
  const app = process.env.NODE_ENV === "production"
    ? createApp()
    : await (async () => {
        const { createServer: createViteServer } = await import("vite");
        const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
        return createApp({ configureFrontend: (serverApp) => { serverApp.use(vite.middlewares); } });
      })();
  const server = createServer(app);
  attachGameSockets(server);
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, "0.0.0.0", () => console.info(JSON.stringify({ event: "server_listening", port, host: "0.0.0.0", env: process.env.NODE_ENV ?? "development" })));
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "fatal", event: "server_start_failed", message: error instanceof Error ? error.message : "unknown error" }));
  process.exit(1);
});
