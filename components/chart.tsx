'use client';
import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/lib/shared';
export default function CandleChart({
  candles,
  identity,
  height = 360,
  tickSize = '0.01',
}: {
  candles: Candle[];
  identity: string;
  height?: number;
  tickSize?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null),
    seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null),
    volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null),
    fitted = useRef(false);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#101212' },
        textColor: '#838a86',
        fontFamily: 'Arial',
        fontSize: 11,
      },
      grid: { vertLines: { color: '#ffffff05' }, horzLines: { color: '#ffffff09' } },
      rightPriceScale: { borderColor: '#252928', scaleMargins: { top: 0.12, bottom: 0.25 } },
      timeScale: { borderColor: '#252928', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#63736a' }, horzLine: { color: '#63736a' } },
    });
    chartRef.current = chart;
    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#b9da83',
      downColor: '#d57877',
      borderVisible: false,
      wickUpColor: '#b9da83',
      wickDownColor: '#d57877',
      priceFormat: {
        type: 'price',
        precision: Math.min(12, (tickSize.replace(/0+$/, '').split('.')[1] || '').length),
        minMove: Number(tickSize) || 0.01,
      },
    });
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
    fitted.current = false;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, [identity, tickSize]);
  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || !candles.length) return;
    seriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      })),
    );
    volumeRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: Number(c.volume),
        color: Number(c.close) >= Number(c.open) ? '#b9da832b' : '#d578772b',
      })),
    );
    if (!fitted.current) {
      chartRef.current
        ?.timeScale()
        .setVisibleLogicalRange({ from: Math.max(0, candles.length - 85), to: candles.length + 3 });
      fitted.current = true;
    }
  }, [candles, identity, tickSize]);
  return (
    <div
      ref={ref}
      className="candle-chart"
      style={{ height }}
      aria-label="Interactive candlestick price chart with volume"
      role="img"
    />
  );
}
