import { createContext, useContext } from "react";
import type { User } from "@nerloq/shared";

export type AuthState =
  | { readonly status: "loading"; readonly user: null }
  | { readonly status: "signed-out"; readonly user: null }
  | { readonly status: "signed-in"; readonly user: User };

export interface AuthContextValue {
  readonly state: AuthState;
  signIn(identifier: string, password: string): Promise<void>;
  register(input: { email: string; username: string; displayName: string; password: string }): Promise<void>;
  updateProfile(input: { username?: string; displayName?: string; bio?: string; websiteUrl?: string | null; isPrivate?: boolean }): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
