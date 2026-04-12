import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'nQ-Swap Monitor — Real-Time DEX Analytics',
  description:
    'High-performance internal dashboard for monitoring nQ-Swap liquidity pools in real-time. Visualizes the top 10 trading pools with live candlestick charts and block confirmation status.',
  keywords: ['DEX', 'monitoring', 'liquidity pools', 'real-time', 'blockchain'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
