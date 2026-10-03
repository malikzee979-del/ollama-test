import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiClient, THEME_MODE_KEY } from '../api/client';
import type { ChatUser } from '../models';

export type ThemeMode = 'dark' | 'light' | 'system';

/**
 * App-wide state: the configured server + current session, shared via React
 * context — the port of mobile/lib/app_state.dart's provider-based AppState.
 */
export interface AppStateValue {
  client: ApiClient;
  initializing: boolean;
  user: ChatUser | null;
  themeMode: ThemeMode;
  isConfigured: boolean;
  isLoggedIn: boolean;
  setServerUrl: (url: string) => Promise<void>;
  setUser: (user: ChatUser | null) => void;
  logout: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  // A single client instance for the life of the app; recreated only when
  // init replaces it (it never does after boot, mirroring the Dart app).
  const [client, setClient] = useState<ApiClient>(() => new ApiClient());
  const [initializing, setInitializing] = useState(true);
  const [user, setUserState] = useState<ChatUser | null>(null);
  // Light is the default ground, same as the web frontend; dark and system
  // are opt-ins persisted under THEME_MODE_KEY.
  const [themeMode, setThemeModeState] = useState<ThemeMode>('light');
  // The client is mutated in place (its baseUrl changes without a new
  // instance), so consumers need a separate signal to re-read it.
  const [serverVersion, setServerVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await ApiClient.load();
      const savedTheme = await AsyncStorage.getItem(THEME_MODE_KEY);
      let me: ChatUser | null = null;
      if (loaded.isConfigured) {
        try {
          me = await loaded.me();
        } catch {
          // Server unreachable or session expired — fall through to login.
          me = null;
        }
      }
      if (cancelled) return;
      setClient(loaded);
      setThemeModeState(
        savedTheme === 'dark' ? 'dark' : savedTheme === 'system' ? 'system' : 'light',
      );
      setUserState(me);
      setInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setServerUrl = useCallback(
    async (url: string) => {
      await client.setServerUrl(url);
      // A login belongs to the previous server (the cookie jar scopes it per
      // host, and the Dart client dropped it outright) — force re-login.
      setUserState(null);
      setServerVersion((v) => v + 1);
    },
    [client],
  );

  const setUser = useCallback((next: ChatUser | null) => setUserState(next), []);

  const logout = useCallback(async () => {
    await client.logout();
    setUserState(null);
  }, [client]);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await AsyncStorage.setItem(THEME_MODE_KEY, mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeModeState((current) => {
      const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(THEME_MODE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      client,
      initializing,
      user,
      themeMode,
      isConfigured: client.isConfigured,
      isLoggedIn: user != null,
      setServerUrl,
      setUser,
      logout,
      setThemeMode,
      toggleTheme,
    }),
    [client, initializing, user, themeMode, serverVersion, setServerUrl, setUser, logout, setThemeMode, toggleTheme],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (ctx == null) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
