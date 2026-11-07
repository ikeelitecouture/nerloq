import React from "react";
import { api } from "../../lib/api";
import { AuthContext, type AuthContextValue, type AuthState } from "./AuthContext";

export function AuthProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = React.useState<AuthState>({ status: "loading", user: null });

  React.useEffect(() => {
    let active = true;
    const onSessionExpired = () => setState({ status: "signed-out", user: null });
    window.addEventListener("nerloq:session-expired", onSessionExpired);
    void api.me()
      .then(({ user }) => { if (active) setState({ status: "signed-in", user }); })
      .catch(() => api.refresh()
        .then(({ user }) => { if (active) setState({ status: "signed-in", user }); })
        .catch(() => { if (active) setState({ status: "signed-out", user: null }); }));
    return () => { active = false; window.removeEventListener("nerloq:session-expired", onSessionExpired); };
  }, []);

  const value = React.useMemo<AuthContextValue>(() => ({
    state,
    async signIn(identifier, password) {
      const { user } = await api.login({ identifier, password });
      setState({ status: "signed-in", user });
    },
    async register(input) {
      const { user } = await api.register(input);
      setState({ status: "signed-in", user });
    },
    async updateProfile(input) {
      const { user } = await api.updateProfile(input);
      setState({ status: "signed-in", user });
    },
    async signOut() {
      try { await api.logout(); } finally { setState({ status: "signed-out", user: null }); }
    },
  }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
