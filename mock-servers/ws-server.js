/**
 * Mock WebSocket Mempool Server — Simulates pending DEX transactions
 * 
 * Broadcasts pending swap transactions at a configurable rate.
 * Includes realistic behaviors: duplicates, out-of-order delivery, 
 * and transactions that never finalize.
 * 
 * Clients can send control messages to adjust the emission rate:
 * { type: "set_rate", rate: 1000 }  — updates per second
 */

const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 4002;

// ─── Pool Config (mirrors RPC server) ───────────────────────────────────────
const POOLS = [
  { id: 'pool-1',  token0: 'ETH',   token1: 'USDC',  basePrice: 3200,   volatility: 0.02 },
  { id: 'pool-2',  token0: 'BTC',   token1: 'USDC',  basePrice: 68000,  volatility: 0.015 },
  { id: 'pool-3',  token0: 'ETH',   token1: 'BTC',   basePrice: 0.047,  volatility: 0.018 },
  { id: 'pool-4',  token0: 'SOL',   token1: 'USDC',  basePrice: 145,    volatility: 0.03 },
  { id: 'pool-5',  token0: 'AVAX',  token1: 'USDC',  basePrice: 38,     volatility: 0.025 },
  { id: 'pool-6',  token0: 'ARB',   token1: 'USDC',  basePrice: 1.15,   volatility: 0.035 },
  { id: 'pool-7',  token0: 'LINK',  token1: 'ETH',   basePrice: 0.0045, volatility: 0.022 },
  { id: 'pool-8',  token0: 'UNI',   token1: 'USDC',  basePrice: 7.8,    volatility: 0.028 },
  { id: 'pool-9',  token0: 'MATIC', token1: 'USDC',  basePrice: 0.72,   volatility: 0.032 },
  { id: 'pool-10', token0: 'AAVE',  token1: 'ETH',   basePrice: 0.032,  volatility: 0.02 },
];

// ─── State ──────────────────────────────────────────────────────────────────
let emissionRate = parseInt(process.env.EMISSION_RATE) || 50; // updates per second
let txCounter = 0;
let currentPrices = {};
let intervalHandle = null;

// Initialize prices
POOLS.forEach(pool => {
  currentPrices[pool.id] = pool.basePrice;
});

/**
 * Generate a random hex string (mock transaction hash)
 */
function randomTxHash() {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * 16)];
  }
  return hash;
}

/**
 * Generate a pending swap transaction
 */
function generatePendingSwap() {
  const pool = POOLS[Math.floor(Math.random() * POOLS.length)];
  const price = currentPrices[pool.id];
  
  // Add noise to simulate price impact of pending swap
  const priceImpact = (Math.random() - 0.5) * 2 * pool.volatility * price * 0.5;
  const pendingPrice = price + priceImpact;
  currentPrices[pool.id] = pendingPrice;

  const isBuy = Math.random() > 0.5;
  const amount = (Math.random() * pool.basePrice * 10) + pool.basePrice * 0.1;
  
  txCounter++;

  return {
    type: 'pending_swap',
    poolId: pool.id,
    token0: pool.token0,
    token1: pool.token1,
    price: Number(pendingPrice.toPrecision(6)),
    amount: Number(amount.toPrecision(6)),
    side: isBuy ? 'buy' : 'sell',
    timestamp: Date.now(),
    txHash: randomTxHash(),
    nonce: txCounter,
    status: 'pending',
    gasPrice: Math.floor(20 + Math.random() * 80),
  };
}

// ─── WebSocket Server ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT });

function broadcastToAll(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

function startEmitting() {
  if (intervalHandle) clearInterval(intervalHandle);
  
  const intervalMs = Math.max(1, Math.floor(1000 / emissionRate));
  const batchSize = Math.max(1, Math.ceil(emissionRate / 1000));

  intervalHandle = setInterval(() => {
    for (let i = 0; i < batchSize; i++) {
      const swap = generatePendingSwap();
      broadcastToAll(swap);

      // 3% chance of sending a duplicate (realistic mempool behavior)
      if (Math.random() < 0.03) {
        setTimeout(() => broadcastToAll(swap), Math.random() * 200);
      }
    }
  }, intervalMs);

  console.log(`[WS] Emitting at ${emissionRate}/sec (interval=${intervalMs}ms, batch=${batchSize})`);
}

wss.on('connection', (socket, req) => {
  console.log(`[WS] Client connected from ${req.socket.remoteAddress}`);
  
  // Send initial config
  socket.send(JSON.stringify({
    type: 'config',
    emissionRate,
    pools: POOLS.map(p => ({ id: p.id, token0: p.token0, token1: p.token1 })),
  }));

  // Handle control messages from clients
  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'set_rate') {
        emissionRate = Math.min(5000, Math.max(1, parseInt(msg.rate) || 50));
        startEmitting();
        broadcastToAll({ type: 'config_update', emissionRate });
        console.log(`[WS] Rate updated to ${emissionRate}/sec`);
      }
    } catch (e) {
      // Ignore invalid messages
    }
  });

  socket.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

wss.on('listening', () => {
  console.log(`[WS Mempool Server] Listening on port ${PORT}`);
  console.log(`[WS Mempool Server] Emission rate: ${emissionRate}/sec`);
  startEmitting();
});
