import "./globals.css";

export const metadata = {
  title: "BTC 5m TA → Up/Down",
  description: "Technical-indicator majority vote for BTC 5-minute direction."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
