import { create } from 'zustand';
import { API_BASE_URL } from '../config/env';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  checkSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

async function readJson(response: Response): Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }> {
  try {
    return await response.json();
  } catch {
    return { ok: false };
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  user: null,

  checkSession: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
    if (!response.ok) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    const body = await readJson(response);
    set({ status: 'authenticated', user: body.data as AuthUser });
  },

  login: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body.error?.message ?? 'Login failed.');
    }
    const data = body.data as { status: string; user?: AuthUser };
    if (data.status === 'pending_totp') {
      throw new Error('This account has 2FA enabled, which this build of PMemUI does not support yet.');
    }
    if (!data.user) {
      throw new Error('Login response did not include a user.');
    }
    set({ status: 'authenticated', user: data.user });
  },

  logout: async () => {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    set({ status: 'unauthenticated', user: null });
  },
}));
