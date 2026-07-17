import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { PreferencesProvider, PREFS_BOOT_SCRIPT } from "@/components/Preferences";
import { ToastProvider } from "@/components/Toast";
import { CommandPalette } from "@/components/CommandPalette";

export const metadata: Metadata = {
  title: "Order Desk — Ritual Matcha Co.",
  description:
    "Paste Viber orders → Shopify drafts + ready replies. Joey confirms everything.",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Order Desk",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f382e" },
    { media: "(prefers-color-scheme: dark)", color: "#131c17" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved theme/density before paint — no flash. */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body className="od-theme-anim min-h-screen">
        <PreferencesProvider>
          <ToastProvider>
            <RegisterServiceWorker />
            <Nav />
            {/* pb clears the fixed mobile bottom nav; removed on lg. */}
            <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 lg:pb-6">
              {children}
            </main>
            <CommandPalette />
          </ToastProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
