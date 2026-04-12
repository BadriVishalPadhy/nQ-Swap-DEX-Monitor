/**
 * RPC Client Service — Polls the mock RPC server for finalized blockchain state.
 * 
 * Architecture:
 * - Maintains a local cache of the last finalized block
 * - Polls every 5 seconds for new blocks
 * - Emits events when new blocks are detected or reorgs occur
 * - Uses EventEmitter for decoupled communication with the pool router
 */

import { EventEmitter } from 'events';
import type { Block } from '@/lib/types';

class RPCClient extends EventEmitter {
  private rpcUrl: string;
  private lastBlock: Block | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  constructor() {
    super();
    this.rpcUrl = process.env.RPC_URL || 'http://localhost:4001';
    this.setMaxListeners(100);
  }

  /**
   * Start polling the RPC server for finalized blocks
   */
  start() {
    if (this.pollInterval) return;

    console.log(`[RPCClient] Starting to poll ${this.rpcUrl} every 5s`);

    // Initial fetch
    this.fetchLatestBlock();

    // Poll every 5 seconds
    this.pollInterval = setInterval(() => {
      this.fetchLatestBlock();
    }, 5000);
  }

  /**
   * Stop polling
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Fetch the latest finalized block from the RPC server
   */
  private async fetchLatestBlock() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const response = await fetch(`${this.rpcUrl}/blocks/latest`);
      if (!response.ok) {
        throw new Error(`RPC returned ${response.status}`);
      }

      const block: Block = await response.json();

      // Detect new block
      if (!this.lastBlock || block.blockNumber > this.lastBlock.blockNumber) {
        const previousBlockNumber = this.lastBlock?.blockNumber || 0;
        this.lastBlock = block;

        // Check for reorg (block number regression — shouldn't happen with our mock but good practice)
        if (block.blockNumber < previousBlockNumber) {
          console.warn(`[RPCClient] Reorg detected! ${previousBlockNumber} -> ${block.blockNumber}`);
          this.emit('block:reorg', block);
        } else {
          console.log(`[RPCClient] New block #${block.blockNumber}`);
          this.emit('block:finalized', block);
        }
      }

      this.emit('status', 'connected');
    } catch (error) {
      console.error('[RPCClient] Failed to fetch block:', (error as Error).message);
      this.emit('status', 'error');
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Get the last known finalized block
   */
  getLastBlock(): Block | null {
    return this.lastBlock;
  }

  /**
   * Get connection status
   */
  getStatus(): 'connected' | 'disconnected' | 'error' {
    return this.lastBlock ? 'connected' : 'disconnected';
  }
}

// Singleton instance
export const rpcClient = new RPCClient();
