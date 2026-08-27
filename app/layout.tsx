import type { Metadata } from 'next';
import './globals.css';
import './evaluation.css';

export const metadata: Metadata = {
  title: 'Kriter Atölyesi | Yönetim Sistemi',
  description: 'Resmî değerlendirme belgelerini rol bazlı yönetim, AI analizi ve hakem kararıyla tek akışta işleyen karar destek sistemi.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
