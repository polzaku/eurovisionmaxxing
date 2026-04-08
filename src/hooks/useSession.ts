"use client";

import { useState, useEffect, useCallback } from "react";
import type { LocalSession } from "@/types";
import { getSession, setSession, clearSession, refreshSessionExpiry } from "@/lib/session";

/**
 * Hook for managing user session from localStorage.
 */
export function useSession() {
  const [session, setSessionState] = useState<LocalSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getSession();
    setSessionState(s);
    setLoading(false);
  }, []);

  const updateSession = useCallback((newSession: LocalSession) => {
    setSession(newSession);
    setSessionState(newSession);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSessionState(null);
  }, []);

  const refresh = useCallback(() => {
    refreshSessionExpiry();
    const s = getSession();
    setSessionState(s);
  }, []);

  return {
    session,
    loading,
    isAuthenticated: session !== null,
    updateSession,
    logout,
    refresh,
  };
}
