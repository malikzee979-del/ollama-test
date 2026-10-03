import { useColorScheme } from 'react-native';

import { useAppState } from '../state/AppStateContext';
import { darkPalette, lightPalette, type ThemeColors } from './design';

/**
 * Resolves the active palette from the persisted theme mode — the React
 * Native equivalent of the web frontend's data-theme attribute.
 */
export function useTheme(): ThemeColors {
  const { themeMode } = useAppState();
  const systemScheme = useColorScheme();
  const dark =
    themeMode === 'dark' || (themeMode === 'system' && systemScheme !== 'light');
  return dark ? darkPalette : lightPalette;
}

export function useIsDark(): boolean {
  const { themeMode } = useAppState();
  const systemScheme = useColorScheme();
  return themeMode === 'dark' || (themeMode === 'system' && systemScheme !== 'light');
}
