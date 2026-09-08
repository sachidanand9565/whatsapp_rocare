import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import CallManager from './components/CallManager';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title:       'Limbu.ai — WhatsApp Business Platform',
  description: 'Send campaigns, manage leads, automate replies on WhatsApp',
  // PWA: lets agents install the panel (required for iOS call-alert push;
  // Android gets the app-like install + nicer notifications)
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32',   type: 'image/png' },
      { url: '/icon-192.png',   sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Limbu.ai' },
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
