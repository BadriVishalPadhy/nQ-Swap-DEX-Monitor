/**
 * Root tRPC Router — Merges all sub-routers.
 */

import { router } from './trpc';
import { poolRouter } from './routers/pools';

export const appRouter = router({
  pools: poolRouter,
});

export type AppRouter = typeof appRouter;
