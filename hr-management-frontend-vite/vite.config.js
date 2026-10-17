import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The app registers the worker itself via virtual:pwa-register (src/lib/pwa.js)
      registerType: "autoUpdate",
      injectRegister: false,
      filename: "sw.js",
      includeAssets: [
        "favicon.ico",
        "favicon.svg",
        "safari-pinned-tab.svg",
        "apple-touch-icon.png",
        "offline.html",
      ],
      manifest: {
        id: "/",
        name: "Xeno-HR - Human Resource Management",
        short_name: "Xeno-HR",
        description: "Human Resource Management System - Manage employees, leaves, attendance, and more",
        theme_color: "#0f172a",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        categories: ["business", "productivity"],
        icons: [
          { src: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
          { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
        shortcuts: [
          {
            name: "Clock in / My Attendance",
            short_name: "Attendance",
            description: "Clock in or out and see your attendance",
            url: "/my-attendance",
            icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
          },
          {
            name: "My Leaves",
            short_name: "Leaves",
            description: "View my leaves",
            url: "/leaves",
            icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Profile",
            short_name: "Profile",
            description: "View my profile",
            url: "/profile",
            icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
          },
        ],
      },
      workbox: {
        // Navigations are handled below (network first, offline page fallback)
        navigateFallback: null,
        runtimeCaching: [
          {
            // App pages: network first; offline → cached shell, else offline.html
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
              precacheFallback: { fallbackURL: "/offline.html" },
            },
          },
          {
            // API GETs: network first with a short-lived per-device cache for offline viewing.
            // Never cache auth / security / secret-bearing endpoints. The cache is deleted
            // on login and logout (src/lib/auth.js) so a user never sees someone else's data.
            urlPattern: ({ url, request }) =>
              request.method === "GET" &&
              url.pathname.startsWith("/api/") &&
              !/^\/api\/(auth|password-reset|setup)\b/.test(url.pathname) &&
              !/^\/api\/v2\/platform\/(2fa|security|api-keys|webhooks|assistant|calendar|public|audit-logs)\b/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [200],
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "image-cache",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\.(?:woff|woff2|ttf|eot)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "font-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false, // Set to true to test PWA in development
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    allowedHosts: true, // allow all hosts
    proxy: {
      // Forward API calls from the Vite dev-server to the backend. "/api/" (with the
      // slash) so app pages whose path merely starts with "api" aren't proxied too.
      "/api/": {
        target: "http://localhost:4001",
        changeOrigin: true,
      },
    },
  },
});
