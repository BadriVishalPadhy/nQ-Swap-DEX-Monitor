/**
 * Main page — Wraps Dashboard with tRPC provider.
 * This is a client-rendered page since the entire dashboard
 * relies on real-time WebSocket data.
 */

'use client';

import { TRPCProvider } from '@/lib/trpc-provider';
import { Dashboard } from '@/components/Dashboard';

export default function Home() {
  return (
    <TRPCProvider>
      <Dashboard />
    </TRPCProvider>
  );
}
