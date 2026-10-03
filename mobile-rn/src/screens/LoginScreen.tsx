import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiException } from '../api/client';
import { Field, IconButton, PrimaryButton } from '../components/ui';
import { AuthMeta, Banner, BrandMark } from '../components/widgets';
import type { RootStackParamList } from '../navigation';
import { useAppState } from '../state/AppStateContext';
import { fonts } from '../theme/design';
import { useTheme } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/** The auth column — brand mark, heading, form — like the web login page. */
export function LoginScreen({ navigation }: Props) {
  const appState = useAppState();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    if (username.trim().length === 0 || password.length === 0) {
      setError('Enter a username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await appState.client.login(username.trim(), password);
      // Setting the user flips isLoggedIn, which swaps the root navigator to
      // the sessions stack — no manual pop needed (the Dart app had to
      // popUntil(isFirst) because its root was rebuilt under a pushed route).
      appState.setUser(user);
    } catch (err) {
      setError(err instanceof ApiException ? err.message : `Login failed: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: 24,
            paddingTop: 24 + insets.top,
            paddingBottom: 24 + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ maxWidth: 360, width: '100%', alignSelf: 'center' }}>
            <View style={{ alignItems: 'center' }}>
              <BrandMark size={36} color={c.brand} />
            </View>
            <View style={{ height: 16 }} />
            <Text
              style={{
                fontFamily: fonts.sansSemiBold,
                fontSize: 26,
                letterSpacing: -0.52,
                color: c.text,
                textAlign: 'center',
              }}
            >
              Welcome back
            </Text>
            <Text
              style={{
                marginTop: 8,
                fontFamily: fonts.sans,
                fontSize: 13.5,
                lineHeight: 21.6,
                color: c.textDim,
                textAlign: 'center',
              }}
            >
              This console runs models on your own hardware. Sign in to open your sessions.
            </Text>
            <View style={{ height: 24 }} />
            {error != null && (
              <>
                <Banner message={error} c={c} testID="login-error-banner" />
                <View style={{ height: 16 }} />
              </>
            )}
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              returnKeyType="next"
              c={c}
              testID="login-username-input"
            />
            <View style={{ height: 12 }} />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={login}
              secureTextEntry
              returnKeyType="done"
              c={c}
              testID="login-password-input"
            />
            <View style={{ height: 16 }} />
            <PrimaryButton label="Log in" onPress={login} busy={busy} c={c} testID="login-button" />
            <View style={{ height: 16 }} />
            <AuthMeta c={c} />
            <View style={{ height: 16 }} />
            <Pressable
              testID="open-signup-button"
              accessibilityRole="button"
              onPress={() => navigation.navigate('Signup')}
              disabled={busy}
              style={{ alignItems: 'center' }}
            >
              <Text style={{ fontFamily: fonts.sans, fontSize: 13.5, color: c.textDim }}>
                No account yet?{' '}
                <Text style={{ color: c.text, fontFamily: fonts.sansSemiBold }}>Create one</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        <View style={{ position: 'absolute', top: insets.top + 8, right: 12 }}>
          <IconButton
            testID="login-server-settings-button"
            accessibilityLabel="Change server"
            onPress={() => navigation.navigate('ServerSetup')}
            icon={<Ionicons name="server-outline" size={19} color={c.textFaint} />}
            c={c}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
