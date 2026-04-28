import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import { getThemeInitScript } from "@/lib/theme";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CalPolySOC Cloud Console",
  description: "Internal private cloud console for CalPolySOC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${manrope.className} min-h-screen bg-background text-foreground antialiased`}
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {getThemeInitScript()}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
