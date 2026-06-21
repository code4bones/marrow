import { ApolloProvider as BaseApolloProvider } from '@apollo/client/react';
import { apolloClient } from '../../shared/api/apollo';

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  return <BaseApolloProvider client={apolloClient}>{children}</BaseApolloProvider>;
}
