import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AppRole = "admin" | "staff" | "viewer";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRole = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .single();
    const next = (data?.role as AppRole) || null;
    setRole((prev) => (prev === next ? prev : next));
  };

  useEffect(() => {
    const stopAuthAutoRefresh = () => {
      supabase.auth.stopAutoRefresh().catch(() => {});
    };

    stopAuthAutoRefresh();
    const stopRefreshTimer = window.setTimeout(stopAuthAutoRefresh, 1000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        // Stabilize identity: only replace the user object when the actual
        // identity fields changed. Supabase re-emits events (channel joins,
        // token refreshes) with fresh-but-equivalent user objects; without
        // this guard every event creates a new `user` reference, which
        // re-fires every [user]-dependent effect (permissions fetch,
        // sync-indicator subscribe) — the resulting re-subscribe emits more
        // auth events → infinite refetch loop.
        setUser((prev) => {
          const next = session?.user ?? null;
          if (!prev && !next) return prev;
          if (!prev || !next) return next;
          return prev.id === next.id && prev.updated_at === next.updated_at ? prev : next;
        });
        if (session?.user) {
          setTimeout(() => fetchRole(session.user.id), 0);
        } else {
          setRole(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser((prev) => {
        const next = session?.user ?? null;
        if (!prev && !next) return prev;
        if (!prev || !next) return next;
        return prev.id === next.id && prev.updated_at === next.updated_at ? prev : next;
      });
      if (session?.user) {
        fetchRole(session.user.id);
      }
      setLoading(false);
    });

    return () => {
      window.clearTimeout(stopRefreshTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, session, role, loading, signIn, signOut, isAdmin: role === "admin" }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
