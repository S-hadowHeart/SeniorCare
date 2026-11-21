import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAccessToken, setSessionExpiredHandler } from "../lib/api";
import type { User } from "../lib/types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface RegisterInput {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role: "SENIOR" | "CAREGIVER";
  timeZone: string;
}

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  // A 401 that cannot be recovered by refreshing means the session is gone.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setStatus("anonymous");
    });
  }, []);

  // Restore the session on a hard reload: the refresh token lives in an
  // httpOnly cookie, so the only way to recover it is to exchange it.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const refreshed = await api.refresh();
        if (cancelled || !refreshed) {
          setStatus("anonymous");
          return;
        }
        const profile = await api.get<User>("/auth/me");
        if (cancelled) return;
        setUser(profile);
        setStatus("authenticated");
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setStatus("anonymous");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ user: User; accessToken: string }>("/auth/login", {
      email,
      password,
    });
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await api.post<{ user: User; accessToken: string }>("/auth/register", input);
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus("authenticated");
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    // Fire the revoke request first so it still carries the access token, but
    // never let a slow network keep someone trapped in a signed-in screen.
    const revoke = api.post("/auth/logout").catch(() => {
      // Signing out locally must succeed even if the server is unreachable.
    });
    signOutLocally();
    await revoke;
  }, [signOutLocally]);

  const refreshProfile = useCallback(async () => {
    const profile = await api.get<User>("/auth/me");
    setUser(profile);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout, refreshProfile }),
    [user, status, login, register, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an <AuthProvider>.");
  }
  return context;
}
