/**
 * Mempool Listener Service — Connects to the mock WebSocket mempool server.
 * 
 * Architecture:
 * - Maintains a persistent WebSocket connection with auto-reconnect
 * - Deduplicates pending transactions via txHash map
 * - Evicts stale pending transactions (TTL: 2 minutes)
 * - Emits 'mempool:pending' events for each new unique pending swap
 * 
 * Memory Safety:
 * - Fixed-size pending buffer (max 5,000 entries)
 * - TTL eviction every 30 seconds
 * - Proper cleanup on stop()
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { PendingSwap, MempoolMessage } from '@/lib/types';

const PENDING_TTL_MS = 120_000; // 2 minutes
const MAX_PENDING_BUFFER = 5_000;
const EVICTION_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

class MempoolListener extends EventEmitter {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private pendingBuffer: Map<string, PendingSwap> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private updateCount = 0;
  private lastCountReset = Date.now();

  constructor() {
    super();
    this.wsUrl = process.env.WS_MEMPOOL_URL || 'ws://localhost:4002';
    this.setMaxListeners(100);
  }

  /**
   * Start listening to the mempool WebSocket
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[MempoolListener] Connecting to ${this.wsUrl}`);
    this.connect();
    this.startEvictionTimer();
  }

  /**
   * Stop listening and clean up
   */
  stop() {
    this.isRunning = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }

    this.pendingBuffer.clear();
    console.log('[MempoolListener] Stopped');
  }

  /**
   * Connect to the WebSocket server
   */
  private connect() {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('[MempoolListener] Connected to mempool');
        this.reconnectAttempts = 0;
        this.emit('status', 'connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg: MempoolMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      });

      this.ws.on('close', () => {
        console.log('[MempoolListener] Connection closed');
        this.emit('status', 'disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[MempoolListener] WebSocket error:', err.message);
        this.emit('status', 'error');
      });
    } catch (err) {
      console.error('[MempoolListener] Failed to connect:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(msg: MempoolMessage) {
    if (msg.type === 'pending_swap') {
      this.handlePendingSwap(msg);
    }
    // Config messages are informational, no action needed
  }

  /**
   * Process a pending swap transaction
   */
  private handlePendingSwap(swap: PendingSwap) {
    // Deduplicate by txHash
    if (this.pendingBuffer.has(swap.txHash)) {
      return;
    }

    // Enforce buffer size limit
    if (this.pendingBuffer.size >= MAX_PENDING_BUFFER) {
      // Evict oldest entries
      const entries = Array.from(this.pendingBuffer.entries());
      const toRemove = entries.slice(0, Math.floor(MAX_PENDING_BUFFER * 0.2));
      toRemove.forEach(([hash]) => this.pendingBuffer.delete(hash));
    }

    this.pendingBuffer.set(swap.txHash, swap);
    this.updateCount++;
    this.emit('mempool:pending', swap);
  }

  /**
   * Schedule a reconnection with exponential backoff
   */
  private scheduleReconnect() {
    if (!this.isRunning) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );

    console.log(`[MempoolListener] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
    this.emit('status', 'reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * Start the TTL eviction timer
   */
  private startEvictionTimer() {
    this.evictionTimer = setInterval(() => {
      const now = Date.now();
      let evicted = 0;

      for (const [hash, swap] of this.pendingBuffer) {
        if (now - swap.timestamp > PENDING_TTL_MS) {
          this.pendingBuffer.delete(hash);
          evicted++;
        }
      }

      if (evicted > 0) {
        console.log(`[MempoolListener] Evicted ${evicted} stale pending txns (buffer: ${this.pendingBuffer.size})`);
      }
    }, EVICTION_INTERVAL_MS);
  }

  /**
   * Remove finalized transactions from the pending buffer
   */
  reconcileBlock(blockNumber: number) {
    // In a real system, we'd check which pending txns were included in the block
    // For mock purposes, we clear pending txns older than the block timestamp
    let reconciled = 0;
    for (const [hash, swap] of this.pendingBuffer) {
      if (swap.timestamp < Date.now() - 15000) {
        this.pendingBuffer.delete(hash);
        reconciled++;
      }
    }
    if (reconciled > 0) {
      console.log(`[MempoolListener] Reconciled ${reconciled} txns for block #${blockNumber}`);
    }
  }

  /**
   * Get current update rate (updates per second)
   */
  getUpdateRate(): number {
    const now = Date.now();
    const elapsed = (now - this.lastCountReset) / 1000;
    if (elapsed < 1) return this.updateCount;
    const rate = this.updateCount / elapsed;
    this.updateCount = 0;
    this.lastCountReset = now;
    return Math.round(rate);
  }

  /**
   * Get pending buffer size
   */
  getPendingCount(): number {
    return this.pendingBuffer.size;
  }

  /**
   * Send a control message to the WebSocket server
   */
  sendControl(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

// Singleton instance
export const mempoolListener = new MempoolListener();
