import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My TTS Dashboard Migration',
  description: 'Next.js migration workspace for the live TTS dashboard'
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
