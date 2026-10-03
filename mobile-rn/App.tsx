import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, BackHandler, Platform, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppStateProvider, useAppState } from './src/state/AppStateContext';
import { focusedInput } from './src/state/inputFocus';
import { useIsDark, useTheme } from './src/theme/useTheme';
import type { RootStackParamList } from './src/navigation';
import { ServerSetupScreen } from './src/screens/ServerSetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { SessionsScreen } from './src/screens/SessionsScreen';
import { ChatScreen } from './src/screens/ChatScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// IBM Plex ships as separate files per weight; expo-font registers each
// under the name given here (which matches the fonts' PostScript names).
const fontAssets = {
  IBMPlexMono: require('./assets/fonts/IBMPlexMono-Regular.ttf'),
  'IBMPlexMono-Medium': require('./assets/fonts/IBMPlexMono-Medium.ttf'),
  'IBMPlexMono-SemiBold': require('./assets/fonts/IBMPlexMono-SemiBold.ttf'),
  IBMPlexSans: require('./assets/fonts/IBMPlexSans-Regular.ttf'),
  'IBMPlexSans-Medium': require('./assets/fonts/IBMPlexSans-Medium.ttf'),
  'IBMPlexSans-SemiBold': require('./assets/fonts/IBMPlexSans-SemiBold.ttf'),
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <Root />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}

/**
 * Picks the active stack based on app state: configure the server first,
 * then log in, then land on the chat list — the React Native version of the
 * Flutter app's _Root widget. Keying the navigator by phase resets its
 * internal route stack on every transition, exactly like the Dart rebuild.
 */
function Root() {
  const [fontsLoaded] = useFonts(fontAssets);
  const appState = useAppState();
  const c = useTheme();
  const dark = useIsDark();

  // Android: BACK while a text input is focused must dismiss the keyboard,
  // not pop the stack or exit the app — on recent API levels the OS does not
  // consume the event for the IME, so without this the app finishes (or
  // navigates) on every BACK typed near a focused field. View focus (tracked
  // in inputFocus) is the reliable signal: Keyboard.isVisible() reports
  // spurious hides after a `uiautomator dump`. This effect mounts after the
  // navigator's own back handler is registered, so BackHandler consults it
  // first and only falls through to navigation when no input is focused.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const input = focusedInput();
      if (input) {
        input.blur();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded || appState.initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.brand} />
      </View>
    );
  }

  const phase = !appState.isConfigured ? 'setup' : !appState.isLoggedIn ? 'auth' : 'main';

  const navTheme = {
    ...DefaultTheme,
    dark,
    colors: {
      ...DefaultTheme.colors,
      primary: c.brand,
      background: c.bg,
      card: c.bg,
      text: c.text,
      border: c.border,
      notification: c.brand,
    },
  };

  return (
    <NavigationContainer key={phase} theme={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {phase === 'setup' && (
          <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
        )}
        {phase === 'auth' && (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
            <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
          </>
        )}
        {phase === 'main' && (
          <>
            <Stack.Screen name="Sessions" component={SessionsScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="ServerSetup" component={ServerSetupScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
