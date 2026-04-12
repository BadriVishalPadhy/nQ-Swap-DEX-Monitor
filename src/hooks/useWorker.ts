/**
 * useWorker Hook — Manages Web Worker lifecycle with Comlink.
 * 
 * - Initializes worker on mount, terminates on unmount
 * - Provides type-safe RPC interface via Comlink.wrap
 * - Prevents memory leaks by ensuring cleanup
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Comlink from 'comlink';
import type { WorkerAPI } from '@/workers/data-processor.worker';

export function useWorker() {
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<WorkerAPI> | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Initialize worker only in browser
    if (typeof window === 'undefined') return;

    const worker = new Worker(
      new URL('../workers/data-processor.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current = worker;
    apiRef.current = Comlink.wrap<WorkerAPI>(worker);
    setIsReady(true);

    console.log('[useWorker] Worker initialized');

    // Cleanup on unmount
    return () => {
      console.log('[useWorker] Terminating worker');
      if (apiRef.current) {
        // Attempt cleanup before termination
        (apiRef.current as any).cleanup?.().catch(() => {});
      }
      worker.terminate();
      workerRef.current = null;
      apiRef.current = null;
      setIsReady(false);
    };
  }, []);

  const getApi = useCallback(() => {
    return apiRef.current;
  }, []);

  return { isReady, getApi, api: apiRef.current };
}
