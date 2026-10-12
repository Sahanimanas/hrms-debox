import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { I18nProvider } from "@/lib/i18n";
import { initPwa } from "@/lib/pwa";

// PWA: capture the install prompt early and register the service worker that
// vite-plugin-pwa generates (/sw.js) — production builds only.
initPwa();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
