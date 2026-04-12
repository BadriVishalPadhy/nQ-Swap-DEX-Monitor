/**
 * Mock RPC Server — Simulates finalized blockchain state
 * 
 * Generates a new "finalized block" every ~12 seconds (Ethereum-like cadence).
 * Each block contains OHLC price data for 10 hardcoded liquidity pools.
 * Prices follow a random walk with mean reversion for realistic behavior.
 */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 4001;

// ─── Pool Definitions ───────────────────────────────────────────────────────
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
let blockNumber = 1000;
let currentPrices = {};
let currentBlock = null;

// Initialize prices
POOLS.forEach(pool => {
  currentPrices[pool.id] = pool.basePrice;
});

/**
 * Random walk with mean reversion.
 * Price drifts randomly but is pulled back toward the base price.
 */
function evolvePrice(pool) {
  const current = currentPrices[pool.id];
  const meanReversionStrength = 0.05;
  const drift = (pool.basePrice - current) * meanReversionStrength;
  const noise = (Math.random() - 0.5) * 2 * pool.volatility * current;
  const newPrice = Math.max(current * 0.5, current + drift + noise);
  currentPrices[pool.id] = newPrice;
  return newPrice;
}

/**
 * Generate OHLC data for a single block interval.
 * Simulates intra-block price movement.
 */
function generateOHLC(pool) {
  const openPrice = currentPrices[pool.id];
  const steps = 20;
  let high = openPrice;
  let low = openPrice;
  let price = openPrice;

  for (let i = 0; i < steps; i++) {
    const noise = (Math.random() - 0.5) * 2 * pool.volatility * price * 0.3;
    price = Math.max(price * 0.95, price + noise);
    high = Math.max(high, price);
    low = Math.min(low, price);
  }

  // Final close price uses the evolved price
  const closePrice = evolvePrice(pool);
  high = Math.max(high, closePrice);
  low = Math.min(low, closePrice);

  return {
    open: Number(openPrice.toPrecision(6)),
    high: Number(Math.max(high, openPrice, closePrice).toPrecision(6)),
    low: Number(Math.min(low, openPrice, closePrice).toPrecision(6)),
    close: Number(closePrice.toPrecision(6)),
  };
}

/**
 * Generate a full finalized block.
 */
function generateBlock() {
  blockNumber++;
  const timestamp = Date.now();

  const pools = POOLS.map(pool => {
    const ohlc = generateOHLC(pool);
    const price = ohlc.close;
    const baseTvl = pool.basePrice * 1000000;
    const tvl = baseTvl * (0.8 + Math.random() * 0.4);
    const volume24h = tvl * (0.05 + Math.random() * 0.1);

    return {
      poolId: pool.id,
      token0: pool.token0,
      token1: pool.token1,
      price,
      priceChange24h: ((price - pool.basePrice) / pool.basePrice) * 100,
      volume24h: Number(volume24h.toPrecision(8)),
      tvl: Number(tvl.toPrecision(8)),
      reserveA: Number((tvl / price / 2).toPrecision(8)),
      reserveB: Number((tvl / 2).toPrecision(8)),
      ohlc,
    };
  });

  currentBlock = {
    blockNumber,
    timestamp,
    parentHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
    pools,
  };

  return currentBlock;
}

// Generate initial block
generateBlock();

// Generate a new block every 12 seconds
setInterval(() => {
  generateBlock();
  console.log(`[RPC] Block #${blockNumber} finalized — ${new Date().toISOString()}`);
}, 12000);

// ─── Routes ─────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/blocks/latest', (req, res) => {
  res.json(currentBlock);
});

app.get('/blocks/:number', (req, res) => {
  // In a real scenario, we'd store historical blocks
  // For mock purposes, return current if it matches, 404 otherwise
  const num = parseInt(req.params.number);
  if (currentBlock && currentBlock.blockNumber === num) {
    return res.json(currentBlock);
  }
  res.status(404).json({ error: 'Block not found' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', blockNumber, timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`[RPC Server] Listening on port ${PORT}`);
  console.log(`[RPC Server] Generating blocks every 12 seconds`);
  console.log(`[RPC Server] Serving ${POOLS.length} pools`);
});
