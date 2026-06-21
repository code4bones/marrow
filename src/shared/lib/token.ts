import { TOKEN_KEY } from '../config/env';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY) ?? '',
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};
