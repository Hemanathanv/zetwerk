import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useLocation } from 'wouter';
import { authApi, REFRESH_TOKEN_KEY, SESSION_TOKEN_KEY } from './api';
import type { AuthUser, UserProfile } from '@/types/backend';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  getProfile: () => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useLocation();

  // Check authentication status on initial load
  const checkAuth = async () => {
    const token = window.localStorage.getItem(SESSION_TOKEN_KEY);
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await authApi.checkAuth();
      setUser(response.data.user);
    } catch (error) {
      console.error('Auth check failed:', error);
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const isPublicAuthPage =
      location === '/login' ||
      location === '/forgot-password' ||
      location === '/reset-password';

    if (isPublicAuthPage) {
      setLoading(false);
      return;
    }

    if (!window.localStorage.getItem(SESSION_TOKEN_KEY)) {
      setUser(null);
      setLoading(false);
      return;
    }

    checkAuth();
  }, [location]);

  const login = async (email: string, password: string) => {
    try {
      const response = await authApi.login(email, password);
      const accessToken = response.data?.access_token;
      const refreshToken = response.data?.refresh_token;
      if (typeof accessToken === 'string' && accessToken.trim()) {
        window.localStorage.setItem(SESSION_TOKEN_KEY, accessToken);
      }
      if (typeof refreshToken === 'string' && refreshToken.trim()) {
        window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
      const authResponse = await authApi.checkAuth();
      setUser(authResponse.data.user);
      setLocation('/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
      setUser(null);
      setLocation('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
      setUser(null);
      setLocation('/login');
    }
  };

  const getProfile = async () => {
    try {
      const response = await authApi.getProfile();
      return response.data;
    } catch (error) {
      console.error('Failed to get profile:', error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    checkAuth,
    getProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
