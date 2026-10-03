import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiException } from '../api/client';
import { Field, IconButton, PrimaryButton } from '../components/ui';
import { Banner, BrandMark } from '../components/widgets';
import type { RootStackParamList } from '../navigation';
import { useAppState } from '../state/AppStateContext';
import { fonts } from '../theme/design';
import { useTheme } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'ServerSetup'>;

/**
 * First-run (and settings-accessible) screen for pointing the app at the
 * Ollama Chat server — a centered column on the plain canvas, like the web
 * frontend's auth pages.
 */
export function ServerSetupScreen({ navigation }: Props) {
  const appState = useAppState();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(appState.client.baseUrl ?? '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canGoBack = navigation.canGoBack();

  const save = async () => {
    const trimmed = url.trim();
    if (trimmed.length === 0 || !(trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
      setError('Enter a full URL, e.g. http://192.168.1.42:4173');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      // Verify the candidate URL is reachable *before* saving it — same
      // reasoning as the Dart screen: a bad URL must never get persisted.
      await appState.client.pingUrl(trimmed);
      await appState.setServerUrl(trimmed);
      // If pushed over another screen (settings entry), return to it;
      // otherwise the root switch swaps us to the login screen on its own.
      if (navigation.canGoBack()) navigation.goBack();
    } catch (err) {
      setError(
        err instanceof ApiException
          ? err.message
          : 'Could not reach that server. Check the URL and that your phone is on the same network.',
      );
    } finally {
      setChecking(false);
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
              Connect to server
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
              Enter the address of the machine running Ollama Chat. Your phone must be able to
              reach it — usually the same Wi-Fi network, using its LAN IP.
            </Text>
            <View style={{ height: 24 }} />
            {error != null && (
              <>
                <Banner message={error} c={c} testID="setup-error-banner" />
                <View style={{ height: 16 }} />
              </>
            )}
            <Field
              label="Server URL"
              value={url}
              onChangeText={setUrl}
              onSubmitEditing={save}
              placeholder="http://192.168.1.42:4173"
              keyboardType="url"
              returnKeyType="go"
              c={c}
              testID="server-url-input"
            />
            <View style={{ height: 16 }} />
            <PrimaryButton
              label="Save & continue"
              onPress={save}
              busy={checking}
              c={c}
              testID="save-server-button"
            />
          </View>
        </ScrollView>
        {canGoBack && (
          <View style={{ position: 'absolute', top: insets.top + 8, left: 12 }}>
            <IconButton
              testID="setup-back-button"
              accessibilityLabel="Back"
              onPress={() => navigation.goBack()}
              icon={<Ionicons name="arrow-back" size={20} color={c.textFaint} />}
              c={c}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
