import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Polypredict Live",
  description: "Polymarket-aligned live price + TA"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}