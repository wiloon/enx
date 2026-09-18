import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import QueryProvider from "@/providers/QueryProvider";
import ApiAuthBridge from "@/providers/ApiAuthBridge";
import RuntimeEnvScript from "@/providers/RuntimeEnvScript";

// Nothing may be prerendered: a statically rendered page would freeze the
// build machine's env into the HTML, defeating the runtime config below.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "https://enx.wiloon.lab"),
  title: "Catglish",
  description: "AI-assisted English reading in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
      <html lang="en">
        <head>
          <RuntimeEnvScript />
        </head>
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
