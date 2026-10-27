import "./globals.css";
import { PostsProvider } from "./providers";
import { AuthProvider } from "./auth-provider";
import { ThemeProvider } from "./theme-provider";
import { NotificationsProvider } from "./notifications-provider";
import { ComposerProvider } from "./composer-provider";
import Shell from "@/components/Shell";
import { DialogProvider } from "@/components/Dialog";
import KeyboardInsets from "@/components/KeyboardInsets";

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "http://linkedoutnetwork.com").replace(/\/$/, "");
const DESC = "LinkedOut is where people tell the truth about work: layoffs, bad bosses, burnout, ghosting and salary reality. Read real stories, see what employees say about a company, and share yours, anonymously if you like.";
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export const metadata = {
  metadataBase: new URL(SITE),
  title: { default: "LinkedOut: the truth about work", template: "%s | LinkedOut" },
  description: DESC,
  applicationName: "LinkedOut",
  keywords: ["layoff stories", "company reviews", "workplace stories", "anonymous work stories", "layoff tracker", "toxic workplace", "interview ghosting", "salary reality", "what employees say"],
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "LinkedOut", title: "LinkedOut: the truth about work", description: DESC, url: SITE },
  twitter: { card: "summary_large_image", title: "LinkedOut: the truth about work", description: DESC },
  robots: { index: true, follow: true },
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION, other: process.env.BING_SITE_VERIFICATION ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION } : undefined } } : {}),
};
const SITE_LD = [
  { "@context": "https://schema.org", "@type": "Organization", name: "LinkedOut", url: SITE, logo: `${SITE}/logo-mark.png`, description: DESC, sameAs: (process.env.NEXT_PUBLIC_SOCIAL_LINKS || "").split(",").map((x) => x.trim()).filter(Boolean) },
  { "@context": "https://schema.org", "@type": "WebSite", name: "LinkedOut", url: SITE, potentialAction: { "@type": "SearchAction", target: `${SITE}/search?q={search_term_string}`, "query-input": "required name=search_term_string" } },
];

// Runs before React hydrates, synchronously, so there's never a flash of
// the wrong theme. Reads the same localStorage key ThemeProvider reads
// (app/theme-provider.js) and sets data-theme immediately; ThemeProvider
// reconciles its own state with this on mount rather than fighting it.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("lo-theme-mode");
    var mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
    var resolved = mode === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    document.documentElement.setAttribute("data-theme", resolved);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased" data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_LD).replace(/</g, "\\u003c") }} />
      </head>
      <body className="min-h-full">
        <KeyboardInsets />
        <ThemeProvider>
          <DialogProvider>
          <AuthProvider>
            <NotificationsProvider>
              <PostsProvider>
                <ComposerProvider>
                  <Shell>{children}</Shell>
                </ComposerProvider>
              </PostsProvider>
            </NotificationsProvider>
          </AuthProvider>
          </DialogProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
