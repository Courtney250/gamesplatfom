import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { io as clientIo, type Socket } from "socket.io-client";
import { getPool } from "../../src/server/db/pool.js";
import { createApp } from "../../src/server/app.js";
import { attachGameSockets } from "../../src/server/games/socket.js";
import type { OutgoingEmail } from "../../src/server/auth/email.js";

type Account = { email: string; cookie: string; csrf: string };
type Ack = { error?: string; match?: unknown; result?: { matchId: string; status: string } };
const enabled = process.env.RUN_POSTGRES_INTEGRATION === "true";
const suite = enabled ? describe.sequential : describe.skip;
const outbox: OutgoingEmail[] = [];
let app: ReturnType<typeof createApp>;
let httpServer: HttpServer;
let socketServer: ReturnType<typeof attachGameSockets>;

async function createVerifiedAccount(): Promise<Account> {
  const email = `socket-${randomUUID()}@duelke.invalid`;
  const username = `s_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const password = "Test-only-Password-9341";
  const registration = await request(app).post("/api/auth/register").send({ email, username, password, acceptedTerms: true, acceptedPrivacy: true });
  expect(registration.status).toBe(202);
  const mail = outbox.find(item => item.to === email);
  if (!mail) throw new Error("The test email adapter did not capture a verification message.");
  const token = mail.text.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error("A verification token was not present in the test-only outbox.");
  expect((await request(app).post("/api/auth/verify-email").send({ token })).status).toBe(200);
  const login = await request(app).post("/api/auth/login").send({ identifier: email, password });
  expect(login.status).toBe(200);
  const cookie = (login.headers["set-cookie"] as string[] | undefined)?.[0]?.split(";", 1)[0];
  if (!cookie?.startsWith("duelke_session=")) throw new Error("No authenticated session cookie was issued.");
  return { email, cookie, csrf: login.body.csrfToken as string };
}
function connect(url: string, account: Account, origin = "http://localhost"): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = clientIo(url, { transports: ["websocket"], auth: { csrfToken: account.csrf }, extraHeaders: { Cookie: account.cookie, Origin: origin }, timeout: 4_000, reconnection: false });
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error("Socket connection timed out.")); }, 5_000);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("connect_error", error => { clearTimeout(timer); socket.disconnect(); reject(error); });
  });
}
function ack(socket: Socket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out.`)), 4_000);
    socket.emit(event, payload, (result: Ack) => { clearTimeout(timer); resolve(result); });
  });
}

suite("authenticated live-match WebSocket flow", () => {
  beforeAll(() => {
    process.env.APP_BASE_URL ??= "http://localhost";
    app = createApp({ emailSender: async message => { outbox.push(message); } });
  });
  afterAll(async () => {
    if (socketServer) await new Promise<void>(resolve => socketServer.close(() => resolve()));
    else if (httpServer?.listening) await new Promise<void>(resolve => httpServer.close(() => resolve()));
    await getPool().end();
  });

  it("requires a valid app origin and CSRF-bound session and broadcasts only participant match events", async () => {
    const white = await createVerifiedAccount();
    const black = await createVerifiedAccount();
    const outsider = await createVerifiedAccount();
    const timeControl = { initialSeconds: 600, incrementSeconds: 0 };
    const waiting = await request(app).post("/api/matches/queue").set("Cookie", white.cookie).set("X-CSRF-Token", white.csrf).send({ game: "chess", stakeKes: "0", timeControl });
    expect(waiting.status).toBe(202);
    const paired = await request(app).post("/api/matches/queue").set("Cookie", black.cookie).set("X-CSRF-Token", black.csrf).send({ game: "chess", stakeKes: "0", timeControl });
    expect(paired.status).toBe(201);
    const matchId = paired.body.matchId as string;
    for (const account of [white, black]) expect((await request(app).post(`/api/matches/${matchId}/ready`).set("Cookie", account.cookie).set("X-CSRF-Token", account.csrf).send({})).status).toBe(200);

    httpServer = createServer(app);
    socketServer = attachGameSockets(httpServer);
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("The local test listener did not expose a TCP port.");
    const url = `http://127.0.0.1:${address.port}`;
    const whiteSocket = await connect(url, white);
    const blackSocket = await connect(url, black);
    let outsiderSocket: Socket | undefined;
    try {
      expect((await ack(whiteSocket, "match:join", { matchId })).match).toBeDefined();
      expect((await ack(blackSocket, "match:join", { matchId })).match).toBeDefined();
      outsiderSocket = await connect(url, outsider);
      const unauthorizedJoin = await ack(outsiderSocket, "match:join", { matchId });
      expect(unauthorizedJoin.error).toBeTruthy();

      const forbiddenOrigin = clientIo(url, { transports: ["websocket"], auth: { csrfToken: outsider.csrf }, extraHeaders: { Cookie: outsider.cookie, Origin: "https://not-the-app.example" }, timeout: 2_000, reconnection: false });
      const originError = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("A foreign origin was not rejected.")), 3_000);
        forbiddenOrigin.once("connect_error", error => { clearTimeout(timer); resolve(error.message); });
        forbiddenOrigin.once("connect", () => { clearTimeout(timer); reject(new Error("A foreign origin was admitted.")); });
      });
      forbiddenOrigin.disconnect();
      expect(originError).toMatch(/origin/i);

      const update = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The opponent did not receive a live match update.")), 4_000);
        blackSocket.once("match:updated", payload => { clearTimeout(timer); resolve(payload); });
      });
      const moveAck = await ack(whiteSocket, "match:move", { matchId, move: { source: "e2", target: "e4" } });
      expect(moveAck.result?.status).toBe("active");
      const updatePayload = await update;
      expect(updatePayload).toMatchObject({ matchId, status: "active" });
    } finally {
      whiteSocket.disconnect(); blackSocket.disconnect(); outsiderSocket?.disconnect();
    }
  });
});
