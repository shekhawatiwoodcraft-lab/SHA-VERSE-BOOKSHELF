import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { registerCurrentSession, clearDeviceToken } from '@/lib/sessionTracker';
import { startSessionRevocationWatcher, stopSessionRevocationWatcher } from '@/lib/sessionRevocationWatcher';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const syncRealtimeAuth = (currentSession: Session | null) => {
    try {
      supabase.realtime.setAuth(currentSession?.access_token ?? null);
    } catch {
      /* ignore transient realtime auth sync error */
    }
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        syncRealtimeAuth(session);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // Register current device session whenever auth state changes to signed-in
        if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          setTimeout(() => {
            registerCurrentSession();
            startSessionRevocationWatcher(session.user.id);
          }, 0);
        }

        if (event === 'SIGNED_OUT') {
          stopSessionRevocationWatcher();
        }
      }
    );

    // Check for existing session safely (network offline / stale refresh must not crash app)
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        syncRealtimeAuth(session);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        if (session?.user) {
          setTimeout(() => {
            registerCurrentSession();
            startSessionRevocationWatcher(session.user.id);
          }, 0);
        }
      })
      .catch((err) => {
        console.warn('[AuthContext] Session restore failed:', err);
        setLoading(false);
      });

    return () => {
      subscription.unsubscribe();
      stopSessionRevocationWatcher();
    };
  }, []);

  const signOut = async () => {
    stopSessionRevocationWatcher();
    clearDeviceToken();
    try {
      await supabase.auth.signOut();
    } catch {
      // Ensure local session state clears even if network signOut fails
    } finally {
      setSession(null);
      setUser(null);
      navigate('/auth', { replace: true });
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
