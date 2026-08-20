import { registerSW } from "virtual:pwa-register";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { toast } from "sonner";
import App from "./App";
import { ApiError } from "./api/client";
import "./i18n";
import "./index.css";

// auto-updating service worker (no-op on insecure origins, e.g. plain http)
registerSW({ immediate: true });

const DAY = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  // every failed mutation anywhere surfaces as a toast — no per-call wiring
  mutationCache: new MutationCache({
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error), {
        // the id ties the toast to a server log line
        description: error instanceof ApiError && error.requestId ? error.requestId : undefined,
      }),
  }),
  defaultOptions: {
    queries: {
      refetchIntervalInBackground: false,
      retry: 1,
      // the default 5 minutes would evict restored data before it can be shown
      gcTime: DAY,
    },
  },
});

// Cached responses survive a cold start, so opening the app offline (or on a
// slow first paint) shows the last known dashboard instead of empty skeletons.
const persister = createAsyncStoragePersister({
  key: "arrdeck-query-cache",
  throttleTime: 2000,
  storage: {
    getItem: (key) => get<string>(key).then((value) => value ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
});

// Anything whose staleness could mislead rather than merely be old. Restoring a
// signed-in auth state from disk would show the app to a signed-out session
// until the refetch lands; a stale setup code would just be wrong.
const NEVER_PERSIST = new Set(["authState", "setupCode", "sessions", "vapidKey"]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: DAY,
        // bump when a cached shape changes incompatibly
        buster: "v1",
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" && !NEVER_PERSIST.has(String(query.queryKey[0])),
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
