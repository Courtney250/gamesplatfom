type DisconnectableSocket = { disconnect(close?: boolean): unknown };

type Registration = { userId: string; sessionHash: string; socket: DisconnectableSocket };
const byUser = new Map<string, Set<DisconnectableSocket>>();
const bySession = new Map<string, Set<DisconnectableSocket>>();
const registrations = new Map<DisconnectableSocket, Registration>();

function remove(socket: DisconnectableSocket): void {
  const registration = registrations.get(socket);
  if (!registration) return;
  registrations.delete(socket);
  const userSockets = byUser.get(registration.userId);
  userSockets?.delete(socket);
  if (userSockets?.size === 0) byUser.delete(registration.userId);
  const sessionSockets = bySession.get(registration.sessionHash);
  sessionSockets?.delete(socket);
  if (sessionSockets?.size === 0) bySession.delete(registration.sessionHash);
}

export function registerSessionSocket(userId: string, sessionHash: string, socket: DisconnectableSocket): () => void {
  registrations.set(socket, { userId, sessionHash, socket });
  const userSockets = byUser.get(userId) ?? new Set<DisconnectableSocket>();
  userSockets.add(socket);
  byUser.set(userId, userSockets);
  const sessionSockets = bySession.get(sessionHash) ?? new Set<DisconnectableSocket>();
  sessionSockets.add(socket);
  bySession.set(sessionHash, sessionSockets);
  return () => remove(socket);
}

function disconnect(sockets: Set<DisconnectableSocket> | undefined): number {
  if (!sockets) return 0;
  const active = [...sockets];
  for (const socket of active) {
    remove(socket);
    socket.disconnect(true);
  }
  return active.length;
}

export function disconnectSessionSockets(sessionHash: string): number {
  return disconnect(bySession.get(sessionHash));
}

export function disconnectUserSockets(userId: string): number {
  return disconnect(byUser.get(userId));
}
