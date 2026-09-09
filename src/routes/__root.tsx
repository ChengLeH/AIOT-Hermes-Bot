import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import appCss from "../styles.css?url";

import { APP_BRAND, APP_SLOGAN } from "@/lib/locale";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: APP_BRAND },
      { name: "application-name", content: APP_BRAND },
      { name: "apple-mobile-web-app-title", content: APP_BRAND },
      { name: "theme-color", content: "#000000" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      {
        name: "description",
        content: APP_SLOGAN,
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", href: "/favicon.png", sizes: "32x32" },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon.png",
        sizes: "32x32",
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-light.png",
        sizes: "32x32",
        media: "(prefers-color-scheme: light)",
      },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192-v3.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512-v3.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;600;700&family=Syne:wght@500;600;700&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="zh-Hant-TW" className="antialiased" data-app-layout="setup" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
