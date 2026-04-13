/**
 * CandlestickChart — lightweight-charts v5 wrapper for real-time candlestick visualization.
 * 
 * Architecture:
 * - Uses TradingView's lightweight-charts v5 with unified addSeries API
 * - Confirmed candles render in standard green/red
 * - Pending (live) candle renders in amber/translucent
 * - Uses series.update() for O(1) incremental updates (no full redraws)
 * - Properly disposes chart on unmount to prevent memory leaks
 * - Chart container is always mounted to avoid ref timing issues
 */

'use client';

import { useEffect, useRef, useState, memo } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData as LWCandlestickData,
  type HistogramData,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts';
import type { CandlestickData, CandleInterval } from '@/lib/types';

interface CandlestickChartProps {
  candles: CandlestickData[];
  pendingCandle: CandlestickData | null;
  selectedInterval: CandleInterval;
  poolId: string | null;
  poolLabel: string;
}

function CandlestickChartComponent({
  candles,
  pendingCandle,
  selectedInterval,
  poolId,
  poolLabel,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const pendingSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [chartReady, setChartReady] = useState(false);

  // Initialize chart — runs once when container is available
  useEffect(() => {
    if (!containerRef.current) return;

    // Ensure container has dimensions before creating chart
    const rect = containerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 400);
    const height = Math.max(rect.height, 300);

    const chart = createChart(containerRef.current, {
      width,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0b0f' },
        textColor: '#5a5c6e',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: 'rgba(99, 102, 241, 0.5)',
          width: 1,
          style: 1,
          labelBackgroundColor: '#6366f1',
        },
        horzLine: {
          color: 'rgba(99, 102, 241, 0.5)',
          width: 1,
          style: 1,
          labelBackgroundColor: '#6366f1',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    // Volume series (overlaid at bottom)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });

    // Confirmed candles series
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceLineVisible: true,
      priceLineColor: '#10b981',
      priceLineWidth: 2,
    });

    // Pending candle series
    const pendingSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'rgba(245, 158, 11, 0.7)',
      downColor: 'rgba(245, 158, 11, 0.4)',
      borderUpColor: 'rgba(245, 158, 11, 0.9)',
      borderDownColor: 'rgba(245, 158, 11, 0.6)',
      wickUpColor: 'rgba(245, 158, 11, 0.7)',
      wickDownColor: 'rgba(245, 158, 11, 0.5)',
      priceLineVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    pendingSeriesRef.current = pendingSeries;
    volumeSeriesRef.current = volumeSeries;
    setChartReady(true);

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width: w, height: h } = entries[0].contentRect;
        if (w > 0 && h > 0) {
          chart.applyOptions({ width: w, height: h });
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      pendingSeriesRef.current = null;
      volumeSeriesRef.current = null;
      setChartReady(false);
    };
  }, []); // Container is always rendered, so this runs on mount

  // Update confirmed candles data
  useEffect(() => {
    if (!seriesRef.current || !chartReady || candles.length === 0) return;

    try {
      const formatted: LWCandlestickData[] = candles.map(c => ({
        time: c.time as unknown as LWCandlestickData['time'],
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      
      const volumeData: HistogramData[] = candles.map(c => ({
        time: c.time as unknown as HistogramData['time'],
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
      }));

      seriesRef.current.setData(formatted);
      volumeSeriesRef.current?.setData(volumeData);

      // Auto-scroll to latest
      if (chartRef.current) {
        chartRef.current.timeScale().scrollToRealTime();
      }
    } catch (err) {
      console.warn('[Chart] Failed to set data:', err);
    }
  }, [candles, poolId, chartReady]);

  // Update pending candle
  useEffect(() => {
    if (!pendingSeriesRef.current || !chartReady) return;

    if (pendingCandle) {
      try {
        pendingSeriesRef.current.update({
          time: pendingCandle.time as unknown as LWCandlestickData['time'],
          open: pendingCandle.open,
          high: pendingCandle.high,
          low: pendingCandle.low,
          close: pendingCandle.close,
        });

        // Also update volume bar for the pending candle
        volumeSeriesRef.current?.update({
          time: pendingCandle.time as unknown as HistogramData['time'],
          value: pendingCandle.volume ?? 0,
          color: pendingCandle.close >= pendingCandle.open ? 'rgba(245, 158, 11, 0.4)' : 'rgba(245, 158, 11, 0.2)',
        });
      } catch {
        // Ignore update errors (e.g., time ordering issues)
      }
    }
  }, [pendingCandle, chartReady]);

  return (
    <div className="chart-container">
      {/* Always render the chart container to avoid ref timing issues */}
      <div
        className="chart-container__inner"
        ref={containerRef}
        id="candlestick-chart"
        style={{ display: poolId ? 'block' : 'none' }}
      />

      {/* Empty state when no pool selected */}
      {!poolId && (
        <div className="chart-container__empty">
          Select a pool to view the candlestick chart
        </div>
      )}

      {/* Legend */}
      {poolId && (
        <div className="chart-container__legend">
          <div className="chart-container__legend-item">
            <div className="chart-container__legend-dot chart-container__legend-dot--confirmed" />
            <span>Finalized</span>
          </div>
          <div className="chart-container__legend-item">
            <div className="chart-container__legend-dot chart-container__legend-dot--pending" />
            <span>Pending</span>
          </div>
        </div>
      )}
    </div>
  );
}

export const CandlestickChart = memo(CandlestickChartComponent);
