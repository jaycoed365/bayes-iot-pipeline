import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "bayes-iot — live sensor dashboard",
  description: "Real-time IoT pipeline with Bayesian time-series forecasting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
