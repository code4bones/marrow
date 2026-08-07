import { useSubscription } from '@apollo/client/react';
import { ON_GATEWAY_EVENT } from '../../shared/api/queries';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';

interface GatewayEventPayload {
  gatewayEvents: {
    event: string;
    payload: unknown;
  };
}

/**
 * Pure side-effect component: subscribes to the single `gatewayEvents` subscription
 * for the whole authenticated session (no per-project resubscribe — the backend
 * filters by the connection's own project membership) and forwards every message
 * into realtime.store, which pages read via useRefetchOnVersion to trigger a
 * background refetch. Renders nothing.
 */
export function RealtimeProvider() {
  const status = useAuthStore((s) => s.status);

  useSubscription<GatewayEventPayload>(ON_GATEWAY_EVENT, {
    skip: status !== 'authenticated',
    onData: ({ data }) => {
      const event = data.data?.gatewayEvents;
      if (event) {
        useRealtimeStore.getState().handleGatewayEvent(event.event, event.payload);
      }
    },
  });

  return null;
}
