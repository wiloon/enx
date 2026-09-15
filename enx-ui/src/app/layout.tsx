import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import QueryProvider from "@/providers/QueryProvider";
import ApiAuthBridge from "@/providers/ApiAuthBridge";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://enx.wiloon.lab"
  ),
  title: "Catseye",
  description: "AI-assisted English reading in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        >
          <QueryProvider>
            <ApiAuthBridge />
            {children}
          </QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
