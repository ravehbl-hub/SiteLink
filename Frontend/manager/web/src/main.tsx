import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@sitelink/tokens/css/tokens.css';
import '@sitelink/tokens/css/neumorphic.css';
import './app/styles.css';
import './i18n';

import { ThemeProvider } from './app/ThemeProvider';
import { AuthProvider } from './app/AuthProvider';
import { Root } from './app/Root';

// "Rapid data" tuning (Part 2 — smart polling). Global defaults favour freshness:
// refetchOnWindowFocus is ON so switching back to the tab catches up live-ish
// screens; a 30s staleTime keeps ordinary/reference reads from refetching on
// every mount. Live screens (dashboard / requests / attendance) OVERRIDE these
// per-query with a tuned refetchInterval + shorter staleTime; those intervals set
// refetchIntervalInBackground:false so nothing polls while the tab is hidden
// (the focus refetch does the catch-up instead).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
