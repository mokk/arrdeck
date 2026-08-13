import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { toast } from "sonner";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./i18n";
import "./index.css";

// auto-updating service worker (no-op on insecure origins, e.g. plain http)
registerSW({ immediate: true });

const queryClient = new QueryClient({
  // every failed mutation anywhere surfaces as a toast — no per-call wiring
  mutationCache: new MutationCache({
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  }),
  defaultOptions: {
    queries: { refetchIntervalInBackground: false, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
