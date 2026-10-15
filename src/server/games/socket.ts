import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { resolveSession, csrfTokenMatches } from "../auth/sessions.js";
import { applyMove, matchForUser } from "./service.js";
import { registerSessionSocket } from "./socket-registry.js";

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return;
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
}
function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const configured = process.env.APP_BASE_URL;
  if (!configured) return false;
  try { return new URL(origin).origin === new URL(configured).origin; }
  catch { return false; }
}

export function attachGameSockets(server: HttpServer): Server {
  const io = new Server(server, { cors: { origin: false, credentials: true }, maxHttpBufferSize: 32_000 });
  io.use(async (socket, next) => {
    try {
      if (!allowedOrigin(socket.handshake.headers.origin)) return next(new Error("Origin is not allowed."));
      const token = cookieValue(socket.handshake.headers.cookie, "duelke_session");
      if (!token) return next(new Error("Authentication required."));
      const session = await resolveSession(token);
      const csrfToken = socket.handshake.auth?.csrfToken;
      if (!session || typeof csrfToken !== "string" || !csrfTokenMatches(session, csrfToken)) return next(new Error("Session or CSRF token is invalid."));
      socket.data.userId = session.user.id;
      socket.data.sessionHash = session.sessionHash.toString("hex");
      next();
    } catch { next(new Error("Unable to authenticate socket.")); }
  });

  io.on("connection", (socket) => {
    const unregister = registerSessionSocket(String(socket.data.userId), String(socket.data.sessionHash), socket);
    socket.on("disconnect", unregister);
    let eventsInWindow = 0;
    let windowStarted = Date.now();
    const rateAllowed = () => {
      const now = Date.now();
      if (now - windowStarted >= 60_000) { windowStarted = now; eventsInWindow = 0; }
      eventsInWindow += 1;
      return eventsInWindow <= 30;
    };
    socket.on("match:join", async (payload: unknown, ack?: (result: unknown) => void) => {
      if (!rateAllowed()) { ack?.({ error: "Too many socket events." }); return; }
      try {
        const matchId = typeof payload === "object" && payload !== null && "matchId" in payload ? String(payload.matchId) : "";
        if (!/^[0-9a-f-]{36}$/i.test(matchId)) { ack?.({ error: "Invalid match id." }); return; }
        const match = await matchForUser(String(socket.data.userId), matchId);
        await socket.join(`match:${matchId}`);
        ack?.({ match });
      } catch (error) { ack?.({ error: error instanceof Error ? error.message : "Unable to join match." }); }
    });
    socket.on("match:move", async (payload: unknown, ack?: (result: unknown) => void) => {
      if (!rateAllowed()) { ack?.({ error: "Too many socket events." }); return; }
      try {
        if (typeof payload !== "object" || payload === null || !("matchId" in payload) || !("move" in payload)) { ack?.({ error: "Invalid move event." }); return; }
        const matchId = String(payload.matchId);
        if (!socket.rooms.has(`match:${matchId}`)) { ack?.({ error: "Join this match before sending moves." }); return; }
        const result = await applyMove(String(socket.data.userId), matchId, payload.move);
        io.to(`match:${matchId}`).emit("match:updated", result);
        ack?.({ result });
      } catch (error) { ack?.({ error: error instanceof Error ? error.message : "Move rejected." }); }
    });
  });
  return io;
}
