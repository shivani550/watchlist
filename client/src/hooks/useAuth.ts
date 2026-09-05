'use client';

import { useState, useEffect, useCallback } from 'react';
import { User } from '@watchlist/shared';
import { api } from '../lib/api';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    const token = api.getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { user: currentUser } = await api.getMe();
      setUser(currentUser);
      setError(null);
    } catch {
      api.setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = async (email: string, pass: string) => {
    setError(null);
    try {
      const res = await api.login(email, pass);
      setUser(res.user);
      return res.user;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
      throw err;
    }
  };

  const register = async (email: string, pass: string) => {
    setError(null);
    try {
      const res = await api.register(email, pass);
      setUser(res.user);
      return res.user;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
      setError(msg);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  };

  return {
    user,
    isAuthenticated: !!user,
    loading,
    error,
    login,
    register,
    logout,
    refreshSession: checkSession,
  };
}
