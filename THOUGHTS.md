# THOUGHTS.md — Architectural Rationale & Technical Trade-offs

> **Author**: Full-Stack Engineer Assessment  
> **Project**: nQ-Swap Real-Time DEX Monitoring Dashboard  
> **Stack**: Next.js 14 (App Router) · tRPC v11 · Zustand · lightweight-charts · Web Workers · Docker

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [State Management Strategy](#2-state-management-strategy)
3. [The Race Condition — Block Confirmation Guard](#3-the-race-condition--block-confirmation-guard)
4. [Performance Architecture](#4-performance-architecture)
5. [Web Worker Design & Memory Leak Prevention](#5-web-worker-design--memory-leak-prevention)
6. [Data Layer — tRPC + Hybrid Sources](#6-data-layer--trpc--hybrid-sources)
7. [Charting Strategy — Why lightweight-charts over D3.js](#7-charting-strategy--why-lightweight-charts-over-d3js)
8. [Security Considerations](#8-security-considerations)
9. [Trade-offs & Alternatives Considered](#9-trade-offs--alternatives-considered)

---

## 1. Architecture Overview

The system is designed around a **three-layer architecture** that cleanly separates data acquisition, processing, and presentation:

```
┌──────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
│  ┌─────────────────┐         ┌─────────────────────────┐        │
│  │  Mock RPC Server │         │  Mock WebSocket Server  │        │
│  │  (Port 4001)     │         │  (Port 4002)            │        │
│  │  Finalized blocks│         │  Pending transactions   │        │
│  │  every ~12s      │         │  50-1000/sec            │        │
│  └────────┬─────────┘         └────────────┬────────────┘        │
└───────────┼────────────────────────────────┼─────────────────────┘
            │                                │
┌───────────┼────────────────────────────────┼─────────────────────┐
│           ▼           BACKEND              ▼                     │
│  ┌─────────────────┐         ┌─────────────────────────┐        │
│  │  RPC Client      │         │  Mempool Listener       │        │
│  │  (Polls HTTP)    │         │  (WS + dedup + TTL)     │        │
│  └────────┬─────────┘         └────────────┬────────────┘        │
│           │                                │                     │
│           ▼         ┌──────────────┐       ▼                     │
│           └────────►│  Pool Router  │◄──────┘                    │
│                     │  (tRPC subs)  │                             │
│                     │  Tags: pending│                             │
│                     │  vs finalized │                             │
│                     └──────┬───────┘                             │
└────────────────────────────┼─────────────────────────────────────┘
                             │ WebSocket (port 3001)
┌────────────────────────────┼─────────────────────────────────────┐
│                    FRONTEND│                                     │
│           ┌────────────────▼───────────────┐                    │
│           │    tRPC Subscription Handler    │                    │
│           └────────────┬───────────────────┘                    │
│                        │                                         │
│           ┌────────────▼───────────────────┐                    │
│           │      Web Worker (Comlink)       │ ◄── Off main thread│
│           │  • OHLC Aggregation             │                    │
│           │  • State Diffing                │                    │
│           │  • Circular Buffers             │                    │
│           └────────────┬───────────────────┘                    │
│                        │ @60fps throttled                        │
│           ┌────────────▼───────────────────┐                    │
│           │     Zustand Stores              │                    │
│           │  • Pool Store (Map<id, Pool>)   │                    │
│           │  • Chart Store (OHLC data)      │                    │
│           └────────────┬───────────────────┘                    │
│                        │ Selective subscriptions                 │
│    ┌───────────┬───────┼───────────┬──────────────┐             │
│    ▼           ▼       ▼           ▼              ▼             │
│  PoolTable  ChartHdr  Chart    StatusBar    StressPanel          │
└──────────────────────────────────────────────────────────────────┘
```

### Why this separation?

**Data Source Independence**: The mock servers are completely standalone Node.js processes. In production, you'd replace these with actual RPC nodes (e.g., Alchemy, Infura) and mempool listeners (e.g., Bloxroute, Flashbots). The backend services abstract this completely.

**Backend as Synchronization Layer**: The tRPC backend is not just a passthrough — it's the critical synchronization point where mempool data and finalized blocks converge. It tags every update with `confirmationStatus`, which is the foundation of the Block Confirmation Guard.

**Worker-Mediated Frontend**: The frontend never processes raw data on the main thread. Every tick goes through the Web Worker for OHLC aggregation before being committed to the Zustand store. This is what enables 1,000 updates/sec without UI freezing.

---

## 2. State Management Strategy

### Why Zustand over Redux, MobX, or Context

**The core constraint**: We receive hundreds of state updates per second from WebSocket data. The state management solution must:

1. **Not cause cascade re-renders** — Only components consuming changed data should re-render
2. **Support high-frequency `set()` calls** — The store must handle rapid mutations without queueing/batching overhead
3. **Be memory-efficient** — No action objects, no middleware chains, no dev-time-only features eating memory
4. **Work with concurrent mode** — React 18's concurrent rendering can cause "tearing" with naive external stores

**Zustand excels here because:**

- **Selective subscriptions**: `usePoolStore(s => s.pools.get(selectedPoolId))` — only the component displaying Pool #3 re-renders when Pool #3 changes. Redux requires `shallowEqual` selectors or `reselect` for this.

- **Built on `useSyncExternalStore`**: This is React's official primitive for external stores in concurrent mode. It prevents tearing by guaranteeing all components see a consistent state snapshot during renders.

- **Zero boilerplate**: No action creators, no reducers, no dispatch. A `set()` call is a direct mutation. This matters when you're calling `set()` 60 times per second.

- **No provider nesting**: Zustand stores are module-level singletons. No `<Provider>` wrapping required. This eliminates context propagation overhead.

### Store Architecture

I split state into two stores:

- **`pool-store`**: Pool metadata, prices, connection status. Updated by tRPC subscription events.
- **`chart-store`**: OHLC candlestick data per pool. Updated by the Web Worker's processed results.

This separation ensures that chart data updates (frequent, large) don't cause re-renders in the pool table, and vice versa. Each component subscribes to the exact slice it needs.

### Throttling Strategy

The subscription handler batches pending updates at a 60fps cap using `performance.now()` comparisons. This means even if the WebSocket delivers 1,000 updates/sec, the React tree is only asked to reconcile ~60 times/sec. The updates are not lost — they're processed by the worker and aggregated into OHLC bars. Only the visual updates are throttled.

---

## 3. The Race Condition — Block Confirmation Guard

### The Problem

In any DEX monitoring system with dual data sources, a fundamental race condition exists:

1. The mempool broadcasts a pending swap at price **$3,250** for ETH/USDC
2. The UI updates to show $3,250 (fast, but unconfirmed)
3. 8 seconds later, the RPC finalizes the block with ETH/USDC at **$3,247**
4. The pending swap at $3,250 was either:
   - Included in the block but with different execution price (slippage)
   - Not included (rejected, outbid, or reverted)
   - Included but in a different block than expected (reorg)

Naively showing the mempool price as "truth" would mislead traders.

### The Solution: Three-State Confirmation Model

Every price update in the system carries a `confirmationStatus`:

| Status | Visual Treatment | Meaning |
|--------|-----------------|---------|
| `pending` | Amber text, pulsing glow | Mempool data — fast but unreliable |
| `confirmed` | White text, brief flash | Soft confirmation (time-based) |
| `finalized` | White text, stable | RPC-confirmed block state |

### Implementation Flow

```
Mempool Event                    RPC Block Event
     │                                │
     ▼                                ▼
Tag: pending                    Tag: finalized
     │                                │
     ▼                                ▼
Pool Store:                     Pool Store:
  pendingPrice = $3,250           price = $3,247
  confirmationStatus = pending    pendingPrice = null
                                  confirmationStatus = finalized
                                  pendingTxCount = 0
```

**Key rule**: The `price` field in the store is ONLY updated by finalized events. Pending events only update `pendingPrice`. The UI always shows the most relevant price but renders it differently based on confirmation status.

### Candlestick Chart Integration

The chart uses two separate series:
1. **Confirmed series** (green/red candles) — Only updated on `finalized` events
2. **Pending series** (amber/translucent candles) — Shows the forming candle from pending data

This means the chart never "commits" a candle based on mempool data. A candle is only set in stone when the RPC confirms the block.

---

## 4. Performance Architecture

### The 1,000 Updates/Second Challenge

Processing 1,000 WebSocket messages per second on the main thread would:
- Consume roughly 30-50ms per frame just for JSON parsing and state diffing
- Leave zero budget for React reconciliation and DOM updates
- Result in <10 FPS and severe UI jank

### Solution: Three-Tier Processing Pipeline

```
Tier 1: Network I/O (tRPC subscription handler)
  → Receives raw events, applies minimal transform
  → Sends to Worker via postMessage (structured clone)
  
Tier 2: Web Worker (off main thread)
  → JSON parsing and validation
  → OHLC aggregation (tick → candle conversion)
  → Circular buffer management
  → Returns processed results via Comlink RPC
  
Tier 3: Main Thread (UI updates)
  → Receives pre-aggregated candle data
  → Updates Zustand store (throttled to 60fps)
  → React reconciliation only for changed components
  → lightweight-charts.update() for O(1) chart updates
```

### Why This Works

| Layer | Work Done | Thread | Frequency |
|-------|-----------|--------|-----------|
| WebSocket receive | Event parsing | Main | 1,000/sec |
| OHLC aggregation | Math + buffers | Worker | 1,000/sec |
| Store update | Map set | Main | 60/sec |
| React render | VDOM diff | Main | 60/sec |
| Chart update | Canvas draw | Main | 60/sec |

The expensive work (OHLC aggregation, buffer management) happens entirely in the Worker. The main thread only receives pre-computed results and applies them.

### FPS Monitoring

The dashboard includes a built-in FPS counter using `requestAnimationFrame` sampling. This provides real-time feedback on whether the main thread is keeping up. If FPS drops below 30, it turns red — indicating the stress test is overwhelming the system.

---

## 5. Web Worker Design & Memory Leak Prevention

### Worker Lifecycle

```typescript
// Initialization (useEffect mount)
const worker = new Worker(new URL('...'), { type: 'module' });
const api = Comlink.wrap(worker);

// Cleanup (useEffect return / unmount)
await api.cleanup();  // Clear internal buffers
worker.terminate();    // Kill the thread
```

**Critical**: `worker.terminate()` is called in the `useEffect` cleanup function. If the user navigates away or the component unmounts, the worker thread is immediately killed, releasing all its memory.

### Memory Safety Mechanisms

1. **Circular Tick Buffer**: Each pool maintains a fixed-size buffer of max 10,000 ticks. When the buffer is full, the oldest entries are evicted. This prevents unbounded growth from continuous streaming data.

2. **Candle Window Pruning**: Only the last 300 candles (configurable via `MAX_CANDLES`) are retained per pool per interval. Historical data beyond the visible chart window is pruned.

3. **Pending Transaction TTL**: The backend's mempool listener evicts pending transactions older than 2 minutes. This prevents stale mempool data from accumulating indefinitely.

4. **WebSocket Reconnection Cleanup**: When the WebSocket reconnects, the old connection's event listeners are properly removed before new ones are attached. No dangling closures.

5. **Chart Instance Disposal**: When the `CandlestickChart` component unmounts, `chart.remove()` is called to properly dispose the lightweight-charts instance. The `ResizeObserver` is also disconnected.

### Why Comlink over raw postMessage

Comlink provides an RPC-like interface over `postMessage`, making worker functions feel like regular async function calls. Benefits:

- **Type safety**: The `WorkerAPI` type is shared between worker and main thread
- **Error propagation**: Exceptions in the worker are properly caught in the main thread
- **No manual message routing**: No `switch/case` on message types — just call `api.processTick(data)`
- **Transferable support**: Comlink can automatically use `Transferable` objects for large buffers

---

## 6. Data Layer — tRPC + Hybrid Sources

### Why tRPC over raw WebSockets or GraphQL

| Feature | tRPC | Raw WS | GraphQL |
|---------|------|--------|---------|
| Type safety | ✅ Full-stack | ❌ Manual | ⚠️ Codegen needed |
| Subscriptions | ✅ Built-in | ✅ Native | ✅ Built-in |
| HTTP queries | ✅ Same router | ❌ Separate API | ✅ Same schema |
| Bundle size | ~8KB | 0KB | ~30KB (Apollo) |
| Boilerplate | Minimal | None | Heavy |

tRPC won because it provides end-to-end type safety with minimal overhead. The `AppRouter` type is shared between server and client — if I change a subscription's output schema, TypeScript catches all consumers at compile time.

### Architecture: Separate WS Server

Next.js API routes are request-response (HTTP). They don't support persistent WebSocket connections. So the tRPC subscription server runs as a separate process on port 3001, using `@trpc/server/adapters/ws`.

The tRPC client uses a `splitLink`:
- **HTTP requests** (queries, mutations) → `/api/trpc` (Next.js API routes)
- **WebSocket requests** (subscriptions) → `ws://localhost:3001` (standalone WS server)

### Backend Service Pattern

The `rpc-client` and `mempool-listener` are singleton services using Node.js `EventEmitter`. This allows:
- **Decoupled publishing**: Services emit events without knowing who listens
- **Multiple subscribers**: Multiple tRPC subscription instances share the same service
- **Lazy initialization**: Services start on first subscription, not on server boot

---

## 7. Charting Strategy — Why lightweight-charts over D3.js

### Decision Matrix

| Criterion | lightweight-charts | D3.js |
|-----------|-------------------|-------|
| Candlestick support | ✅ Native | ⚠️ Manual implementation |
| Incremental updates | ✅ `series.update()` O(1) | ❌ Full data join required |
| Rendering | WebGL/Canvas | SVG/Canvas (manual) |
| Bundle size | ~45KB | ~80KB (full) |
| Financial features | Crosshair, volume, scales | DIY everything |
| Learning curve | Low | High |

### The Key Differentiator: `series.update()`

D3.js uses a data-join pattern (`enter/update/exit`) that requires diffing the entire dataset on every change. For a chart with 200 candles updating 60 times per second, this means:

- D3: Diff 200 elements × 60/sec = 12,000 comparisons/sec
- lightweight-charts: Call `update(lastCandle)` = 1 operation/sec (O(1))

This is the single most impactful performance decision for the chart rendering.

### Trade-off Acknowledged

D3.js offers unlimited customization — any visualization is possible. lightweight-charts constrains you to financial charts. Since this is a trading dashboard, that constraint is actually a feature — it provides battle-tested financial UX (crosshair, price scale, time scale) out of the box.

---

## 8. Security Considerations

### Input Validation

All WebSocket messages from the mempool mock are parsed with `JSON.parse` inside a try-catch. Malformed messages are silently dropped. In production, I would add Zod schema validation on every incoming message.

### Rate Limiting

The mempool listener has built-in rate protection:
- `MAX_PENDING_BUFFER = 5,000` — caps memory usage regardless of input rate
- TTL eviction removes stale entries every 30 seconds
- The Web Worker's circular buffer caps at 10,000 entries per pool

### No Secrets in Client Bundle

All environment variables (`RPC_URL`, `WS_MEMPOOL_URL`) are server-side only. The client never directly connects to the mock servers — it goes through the tRPC API.

### WebSocket Origin Validation

In production, the tRPC WebSocket server should validate the `Origin` header to prevent cross-site WebSocket hijacking. For this local development setup, CORS is permissive.

---

## 9. Trade-offs & Alternatives Considered

### SSE vs WebSocket for Client Subscriptions

tRPC supports both Server-Sent Events (SSE) and WebSockets for subscriptions. SSE is simpler (HTTP-based, auto-reconnect, no separate server) but is unidirectional. I chose WebSockets because:

1. The stress test panel needs to send control messages to adjust the emission rate (bidirectional)
2. WebSockets have lower per-message overhead than SSE (no HTTP headers per event)
3. At 1,000 updates/sec, the header overhead of SSE becomes measurable

### Zustand vs Jotai

Jotai (atomic state) could have worked here by defining each pool as an independent atom. This would give even more granular re-render control. However, Zustand's Map-based approach already achieves this via selectors, with less API surface to learn.

### Single Store vs Multiple Stores

I chose to split into `pool-store` and `chart-store` rather than a single mega-store. This prevents chart data mutations (which are frequent and large) from triggering re-render checks in pool table components. The trade-off is slightly more complex data flow, but the performance benefit is worth it.

### Mock Server Fidelity

The mock servers simulate realistic blockchain behavior (12s blocks, random walk prices, mempool duplicates) but don't simulate actual transaction ordering, gas auctions, or MEV. For a production system, these would significantly affect how pending prices are displayed and how the confirmation guard discards or validates pending data.

---

*This document is a living artifact. As the system evolves, these rationale documents should be updated to reflect new trade-offs and architectural decisions.*
