import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Outfit, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: { default: "CodeCapture", template: "%s · CodeCapture" },
  description: "Photographie du code sur le téléphone, récupère les fichiers sur l'ordinateur.",
  applicationName: "CodeCapture",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "CodeCapture", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0e0f0c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${syne.variable} ${outfit.variable} ${mono.variable}`}>
      <body style={{ background: "#0e0f0c", color: "#f3f5ef" }}>{children}</body>
    </html>
  );
}
