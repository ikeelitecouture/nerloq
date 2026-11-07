import React from "react";
import type { Socket } from "socket.io-client";
export const RealtimeContext = React.createContext<Socket | null>(null);
export function useRealtime(): Socket | null { return React.useContext(RealtimeContext); }
