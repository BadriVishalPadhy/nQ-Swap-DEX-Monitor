/**
 * tRPC Client Setup — Configures HTTP + WebSocket links.
 * 
 * Architecture:
 * - HTTP link for queries/mutations → Next.js API routes (/api/trpc)
 * - WebSocket link for subscriptions → Standalone WS server (port 3001)
 * - splitLink routes based on operation type
 */

'use client';

import { createTRPCReact } from '@trpc/react-query';
import { createWSClient, httpBatchLink, splitLink, wsLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@/server/router';

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  return `http://localhost:${process.env.PORT || 3000}`;
}

function getWsUrl() {
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:3001`;
  }
  return 'ws://localhost:3001';
}

let wsClient: ReturnType<typeof createWSClient> | null = null;

function getWsClient() {
  if (!wsClient) {
    wsClient = createWSClient({
      url: getWsUrl(),
      onClose(cause) {
        console.log('[tRPC WS] Connection closed', cause);
      },
      onOpen() {
        console.log('[tRPC WS] Connection opened');
      },
    });
  }
  return wsClient;
}

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: wsLink({
          client: getWsClient(),
          transformer: superjson,
        }),
        false: httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      }),
    ],
  });
}
