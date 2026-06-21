export const GRAPHQL_HTTP_URL =
  import.meta.env.VITE_GRAPHQL_URL ?? 'http://127.0.0.1:7000/api/graphql';

export const GRAPHQL_WS_URL = GRAPHQL_HTTP_URL.replace(/^https/, 'wss').replace(
  /^http/,
  'ws',
);

export const TOKEN_KEY = 'pmem_token';
