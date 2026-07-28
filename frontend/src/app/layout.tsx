import type { Metadata } from "next";
import { Inter, Orbitron } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

// next/font downloads and self-hosts these at BUILD time — no runtime request to
// fonts.googleapis.com, no render-blocking fetch, no layout shift, and the app keeps working
// offline. `display: swap` + the CSS var wiring is handled for us.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-orbitron",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Watches Liquid — Luxury Watch Perpetuals",
  description: "Perpetual futures on luxury watch prices. Long or short with leverage, no physical ownership.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${orbitron.variable}`} style={{ backgroundColor: '#08080a' }}>
      <head>
        {/*
          Silences hydration noise caused by DOM-rewriting browser extensions — Bitdefender
          stamps bis_skin_checked / bis_register / __processed_ onto elements before React
          hydrates, which React then reports as a server/client mismatch. Nothing we can fix in
          app code; it is the user's extension editing the page.

          This filter is deliberately NARROW. The previous version dropped any message
          containing "hydration" or "hydrated", which also hid OUR hydration bugs — the exact
          class of bug this file's suppressor exists to work around. A real mismatch must still
          reach the console.

          Note this cannot silence Next's dev overlay: it intercepts console.error upstream of
          this patch, on purpose. To lose the overlay, disable the extension for localhost.
        */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var EXT = ['bis_skin_checked','bis_register','__processed_','data-new-gr-c-s-check-loaded','data-gr-ext-installed'];
            function isExtensionNoise(args){
              for (var i = 0; i < args.length; i++) {
                var a = args[i];
                if (typeof a !== 'string') continue;
                for (var j = 0; j < EXT.length; j++) if (a.indexOf(EXT[j]) > -1) return true;
              }
              return false;
            }
            var e = console.error;
            console.error = function(){ if (!isExtensionNoise(arguments)) e.apply(console, arguments); };
            var w = console.warn;
            console.warn = function(){ if (!isExtensionNoise(arguments)) w.apply(console, arguments); };
          })();
        `}} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
