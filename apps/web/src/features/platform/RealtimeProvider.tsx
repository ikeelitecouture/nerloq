import React from "react";
import type { Socket } from "socket.io-client";
import { useAuth } from "../auth/AuthContext";
import { connectRealtime, disconnectRealtime } from "../../lib/realtime";
import { RealtimeContext } from "./RealtimeContext";
export function RealtimeProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { state } = useAuth();
  const [socket, setSocket] = React.useState<Socket | null>(null);
  React.useEffect(() => {
    if (state.status !== "signed-in") { queueMicrotask(() => setSocket(null)); return; }
    const connection = connectRealtime();
    let active = true;
    queueMicrotask(() => { if (active) setSocket(connection); });
    return () => { active = false; disconnectRealtime(connection); setSocket(current => current === connection ? null : current); };
  }, [state.status]);
  return <RealtimeContext.Provider value={socket}>{children}</RealtimeContext.Provider>;
}
