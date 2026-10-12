Xeno-HR icons
=============

Yellow (#FACC15) rounded tile with a bold dark-slate (#0F172A) geometric "X".
Generated programmatically (Node + zlib, no image tools) — see the platform
module notes. Regenerate all files together if the artwork changes.

PNG:
- favicon-16x16.png, favicon-32x32.png, favicon-48x48.png   browser tabs / shortcuts
- android-chrome-192x192.png, android-chrome-512x512.png    PWA icons (rounded tile, purpose "any")
- maskable-icon-512x512.png                                 PWA maskable icon (full bleed, mark inside the safe zone)
- apple-touch-icon.png (180), apple-touch-icon-152x152.png,
  apple-touch-icon-167x167.png, apple-touch-icon-180x180.png  iOS (full bleed; iOS rounds the corners)
- logo.png (512)                                            generic logo tile

Other:
- favicon.ico            16/32/48 PNG-compressed ICO
- favicon.svg            scalable favicon
- safari-pinned-tab.svg  monochrome mask icon
- offline.html           shown by the service worker when offline and the page isn't cached
- site.webmanifest       legacy manifest (vite-plugin-pwa generates manifest.webmanifest)
