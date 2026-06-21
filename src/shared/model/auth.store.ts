import { create } from 'zustand';
import { tokenStorage } from '../lib/token';

interface AuthState {
  token: string;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: tokenStorage.get(),
  isAuthenticated: Boolean(tokenStorage.get()),
  login: (token) => {
    tokenStorage.set(token);
    set({ token, isAuthenticated: true });
  },
  logout: () => {
    tokenStorage.clear();
    set({ token: '', isAuthenticated: false });
  },
}));
