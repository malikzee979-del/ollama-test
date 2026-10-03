import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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

type Props = NativeStackScreenProps<RootStackParamList, 'Signup'>;

/**
 * Mirrors the signup rules enforced server-side (see auth.js): username
 * 3-32 chars of letters/numbers/`_`/`.`/`-`, password 8+ chars. Client-side
 * validation here is just for a faster error message — the server
 * re-validates regardless.
 */
export function SignupScreen({ navigation }: Props) {
  const appState = useAppState();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signup = async () => {
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await appState.client.signup(username.trim(), password);
      appState.setUser(user);
    } catch (err) {
      setError(err instanceof ApiException ? err.message : `Sign up failed: ${err}`);
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
              Create account
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
              The account is created in a SQLite file on this machine. There is no server to
              register with.
            </Text>
            <View style={{ height: 24 }} />
            {error != null && (
              <>
                <Banner message={error} c={c} testID="signup-error-banner" />
                <View style={{ height: 16 }} />
              </>
            )}
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              helper='3–32 characters: letters, numbers, "_", "." or "-".'
              returnKeyType="next"
              c={c}
              testID="signup-username-input"
            />
            <View style={{ height: 12 }} />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              helper="At least 8 characters."
              secureTextEntry
              returnKeyType="next"
              c={c}
              testID="signup-password-input"
            />
            <View style={{ height: 12 }} />
            <Field
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={signup}
              secureTextEntry
              returnKeyType="done"
              c={c}
              testID="signup-confirm-input"
            />
            <View style={{ height: 16 }} />
            <PrimaryButton
              label="Sign up"
              onPress={signup}
              busy={busy}
              c={c}
              testID="signup-button"
            />
            <View style={{ height: 16 }} />
            <AuthMeta c={c} />
          </View>
        </ScrollView>
        <View style={{ position: 'absolute', top: insets.top + 8, left: 12 }}>
          <IconButton
            testID="signup-back-button"
            accessibilityLabel="Back"
            onPress={() => navigation.goBack()}
            icon={<Ionicons name="arrow-back" size={20} color={c.textFaint} />}
            c={c}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
