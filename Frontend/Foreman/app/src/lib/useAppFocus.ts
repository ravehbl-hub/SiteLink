/**
 * React Query <-> React Native AppState bridge (rapid-data Part 2).
 *
 * In React Native there is no browser window "focus" event, so react-query's
 * `refetchOnWindowFocus` is a no-op until we feed it AppState transitions. This
 * hook wires AppState -> focusManager ONCE (mount it a single time near the app
 * root). When the app returns to the foreground, focusManager reports "focused"
 * and any mounted query with refetchOnWindowFocus (the default) refetches its
 * stale data — giving a free "catch-up" on foreground without background polling.
 *
 * Idempotent: the AppState subscription is cleaned up on unmount.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { focusManager } from '@tanstack/react-query';

export function useAppFocusManager(): void {
  useEffect(() => {
    // focusManager only supports web-style focus by default; on native we drive it
    // ourselves from AppState. 'active' === foreground.
    const onChange = (state: AppStateStatus) => {
      if (Platform.OS !== 'web') {
        focusManager.setFocused(state === 'active');
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);
}
