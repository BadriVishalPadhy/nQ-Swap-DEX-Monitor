/**
 * Standalone WebSocket server for tRPC subscriptions.
 * 
 * Next.js API routes don't support persistent WebSocket connections,
 * so we run a separate WS server on port 3001 for tRPC subscriptions.
 * This is started as a separate process alongside the Next.js dev server.
 */

import { WebSocketServer } from 'ws';
import { applyWSSHandler } from '@trpc/server/adapters/ws';
import { appRouter } from './router';

const PORT = parseInt(process.env.WS_PORT || '3001');

const wss = new WebSocketServer({ port: PORT });

const handler = applyWSSHandler({
  wss,
  router: appRouter,
});

console.log(`[tRPC WS Server] Listening on ws://localhost:${PORT}`);

process.on('SIGTERM', () => {
  console.log('[tRPC WS Server] SIGTERM received');
  handler.broadcastReconnectNotification();
  wss.close();
  process.exit(0);
});
