import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setCsrfToken } from "./api.js";

export type AuthUser = { id: string; email: string; username: string; role: string; status: string };
type AuthContextValue = { user: AuthUser | null; loading: boolean; reload: () => Promise<void>; signIn: (identifier: string, password: string) => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    try {
      const response = await api<{ user: AuthUser }>("/api/auth/me");
      setUser(response.user);
      await api<{ csrfToken: string }>("/api/auth/csrf").then((result) => setCsrfToken(result.csrfToken));
    } catch { setUser(null); setCsrfToken(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  const signIn = async (identifier: string, password: string) => {
    const result = await api<{ csrfToken: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) });
    setCsrfToken(result.csrfToken);
    await reload();
  };
  const signOut = async () => {
    try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
    finally { setUser(null); setCsrfToken(null); }
  };
  const value = useMemo(() => ({ user, loading, reload, signIn, signOut }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
