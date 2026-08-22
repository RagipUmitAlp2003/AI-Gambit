import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kriter Atölyesi | Değerlendirme Profili',
  description: 'Resmî değerlendirme PDF’lerini izlenebilir ve onaylanabilir kriter profillerine dönüştüren yönetici aracı.',
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
