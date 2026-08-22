import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import CallManager from './components/CallManager';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title:       'WA SaaS — WhatsApp Business Platform',
  description: 'Send campaigns, manage leads, automate replies on WhatsApp',
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
