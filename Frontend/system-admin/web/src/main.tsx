import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@sitelink/tokens/css/tokens.css';
import './app/styles.css';
import './i18n';

import { ThemeProvider } from './app/ThemeProvider';
import { AuthProvider } from './app/AuthProvider';
import { Root } from './app/Root';

// "Rapid data" tuning (Part 2 — smart polling). Admin data is NOT real-time
// critical, so the default cadence is focus-only: refetchOnWindowFocus ON (catch
// up when the operator returns to the tab) with a 30s staleTime. The dashboard's
// health checks keep their own background refetchInterval; the CRUD list screens
// override staleTime longer and do NOT poll (see each screen).
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
