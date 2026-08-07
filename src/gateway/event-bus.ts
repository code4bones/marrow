// T-MEMORY-042: single in-process event bus every gateway mutation flows
// through (via recordEventForProject() in pg-tool-service.ts), consumed by
// exactly one GraphQL subscription field (Subscription.gatewayEvents in
// graphql.ts) over the WS transport wired up in http-server.ts. Wraps
// graphql-subscriptions' PubSub rather than hand-rolling an async iterator
// with correct subscribe/unsubscribe/cleanup semantics -- a small, pure-JS
// dependency with no native bindings, and exactly the kind of thing that's
// easy to get subtly wrong by hand.
import { PubSub } from "graphql-subscriptions";

/** Shape published for every mutation, regardless of domain (task/decision/memory/artifact/link/event/project). */
export interface GatewayEventEnvelope {
  event: string;
  payload: Record<string, unknown>;
}

export const GATEWAY_EVENT_TOPIC = "gatewayEvent";

/** Process-wide singleton -- one gateway process, one in-memory bus, no cross-replica fan-out (same scale assumption as the login rate limiter in http-server.ts). */
export const gatewayEvents = new PubSub<{ [K in typeof GATEWAY_EVENT_TOPIC]: GatewayEventEnvelope }>();
