import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { Header } from '@/components/ui';
import './globals.css';
export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: { default: 'ORBIT Exchange — Find your edge.', template: '%s | ORBIT Exchange' },
  description:
    'A precise, thoughtfully designed cryptocurrency paper trading simulator. Genuine Binance spot data, sixteen markets including HYPE, and transparent paper execution. New accounts start at zero.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Provider>
          <Header />
          <div id="main-content">{children}</div>
        </Provider>
      </body>
    </html>
  );
}
