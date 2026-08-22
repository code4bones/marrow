import { ApolloClient, ApolloLink, HttpLink, InMemoryCache, split } from '@apollo/client/core';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient } from 'graphql-ws';
import { GRAPHQL_HTTP_URL, GRAPHQL_WS_URL } from '../config/env';

const httpLink = new HttpLink({ uri: GRAPHQL_HTTP_URL, credentials: 'include' });

// graphql-ws defaults to giving up after 5 reconnect attempts -- fine for a
// short-lived blip, not for a long-lived browser tab that outlives a backend
// deploy/restart (this app's own gatewayEvents subscription needs to survive
// exactly that). Retry indefinitely with the library's default randomised
// backoff instead of ever going permanently silent until a manual refresh.
const wsLink = new GraphQLWsLink(
  createClient({ url: GRAPHQL_WS_URL, retryAttempts: Infinity, shouldRetry: () => true }),
);

const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query);
    return def.kind === 'OperationDefinition' && def.operation === 'subscription';
  },
  wsLink,
  ApolloLink.from([httpLink]),
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
  // Without this, every useQuery defaults to cache-first: once a (query,
  // variables) pair is cached, remounting it -- e.g. switching project away
  // and back -- replays the stale snapshot with no network request at all.
  // The realtime WS subscription (useRefetchOnVersion) is meant to be the
  // safety net for "data changed while cached", but it only helps if the
  // event actually arrives AND the consuming component is mounted at that
  // exact moment -- one missed event (reconnect gap, proxy buffering, a
  // backgrounded tab) leaves no way to self-heal short of a hard reload.
  // cache-and-network still paints instantly from cache but always fires a
  // background network request on every mount, so any page self-heals on
  // its own next visit regardless of whether the WS event was ever seen.
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network' },
  },
});
