import { io, type Socket } from "socket.io-client";
import { api, ApiClientError } from "./api";

let sharedSocket: Socket | null = null;
let refreshInFlight = false;

export function connectRealtime(): Socket {
  if (sharedSocket) return sharedSocket;
  const configuredApi = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";
  const origin = configuredApi.startsWith("/") ? window.location.origin : new URL(configuredApi).origin;
  const socket = io(origin, { path: "/socket.io", withCredentials: true, autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 500, reconnectionDelayMax: 8000, timeout: 10_000 });
  socket.on("connect_error", error => {
    if (refreshInFlight || !["SESSION_EXPIRED", "AUTHENTICATION_REQUIRED"].includes(error.message)) return;
    refreshInFlight = true;
    void api.refresh().then(() => { if (!socket.connected) socket.connect(); }).catch(error => {
      if (error instanceof ApiClientError && error.status === 401) window.dispatchEvent(new Event("nerloq:session-expired"));
    }).finally(() => { refreshInFlight = false; });
  });
  sharedSocket = socket;
  return socket;
}

export function disconnectRealtime(socket: Socket): void {
  if (sharedSocket === socket) sharedSocket = null;
  socket.removeAllListeners();
  socket.disconnect();
}
