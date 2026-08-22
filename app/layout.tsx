import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import CallManager from './components/CallManager';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title:       'WA SaaS — WhatsApp Business Platform',
  description: 'Send campaigns, manage leads, automate replies on WhatsApp',
  // PWA: lets agents install the panel (required for iOS call-alert push;
  // Android gets the app-like install + nicer notifications)
  manifest: '/manifest.json',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'WA Panel' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        {/* Global softphone — survives navigation so calls don't drop */}
        <CallManager />
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
