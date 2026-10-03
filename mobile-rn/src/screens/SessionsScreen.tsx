import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostButton } from '../components/ui';
import { Banner, StatusDot, type LedState } from '../components/widgets';
import type { ChatSessionSummary } from '../models';
import type { RootStackParamList } from '../navigation';
import { useAppState } from '../state/AppStateContext';
import { fonts, radii, type ThemeColors } from '../theme/design';
import { useIsDark, useTheme } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

/**
 * The chat register — the mobile port of the web frontend's sidebar: a soft
 * tinted ground, an outlined "New chat" button, rounded title rows, and a
 * quiet footer with the status dot, theme/settings rows and the account row.
 */
export function SessionsScreen({ navigation }: Props) {
  const appState = useAppState();
  const c = useTheme();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<ChatSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [led, setLed] = useState<LedState>('idle');
  const [refreshing, setRefreshing] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await appState.client.listSessions();
      setSessions(list);
      setError(null);
      setLed('ok');
    } catch (err) {
      setLed('bad');
      setError(`Could not load chats: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [appState.client]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openNewChat = async () => {
    const session = await appState.client.createSession();
    navigation.navigate('Chat', { sessionId: session.id, initialTitle: session.title });
  };

  const deleteSession = async (summary: ChatSessionSummary) => {
    try {
      await appState.client.deleteSession(summary.id);
      // Hide immediately, then reload — mirrors the Dart refresh-after-delete.
      setDeletedIds((prev) => new Set(prev).add(summary.id));
      await load();
      setDeletedIds(new Set());
    } catch (err) {
      setError(`Could not delete chat: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const hostLabel = (): string => {
    const base = appState.client.baseUrl;
    if (base == null) return '';
    try {
      const uri = new URL(base);
      if (!uri.hostname) return base;
      return uri.port ? `${uri.hostname}:${uri.port}` : uri.hostname;
    } catch {
      return base;
    }
  };

  const visible = (sessions ?? []).filter((s) => !deletedIds.has(s.id));

  return (
    <View style={{ flex: 1, backgroundColor: c.bgSidebar }}>
      {/* Sidebar header: the outlined "New chat" button. */}
      <View style={{ padding: 12, paddingTop: 12 + insets.top }}>
        <Pressable
          testID="new-session-button"
          accessibilityRole="button"
          onPress={openNewChat}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            height: 40,
            paddingHorizontal: 12,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: pressed ? c.bgHover : 'transparent',
          })}
        >
          <Ionicons name="create-outline" size={16} color={c.text} />
          <Text style={{ marginLeft: 8, fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}>
            New chat
          </Text>
        </Pressable>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 8 }}>
        {sessions == null && error == null ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.textFaint} />
          </View>
        ) : error != null && sessions == null ? (
          <View style={{ padding: 16 }}>
            <Banner message={error} c={c} testID="sessions-error-banner" />
          </View>
        ) : visible.length === 0 ? (
          <EmptyList c={c} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={c.textFaint}
                colors={[c.textFaint]}
                progressBackgroundColor={c.bgSidebar}
              />
            }
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item, index }) => (
              <SessionRow
                index={index}
                session={item}
                c={c}
                onTap={() =>
                  navigation.navigate('Chat', { sessionId: item.id, initialTitle: item.title })
                }
                onDelete={() => deleteSession(item)}
              />
            )}
          />
        )}
      </View>

      {/* Sidebar footer: status dot, quiet rows, account row. */}
      <View style={{ padding: 8, paddingBottom: 8 + insets.bottom }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <StatusDot state={led} c={c} />
          <Text
            numberOfLines={1}
            style={{ marginLeft: 8, flex: 1, fontFamily: fonts.sans, fontSize: 12, color: c.textFaint }}
            testID="status-rail-host"
          >
            {hostLabel().length === 0 ? 'local' : hostLabel()}
          </Text>
        </View>
        <GhostButton
          label={dark ? 'Dark mode' : 'Light mode'}
          icon={
            <Ionicons name={dark ? 'moon-outline' : 'sunny-outline'} size={16} color={c.text} />
          }
          onPress={appState.toggleTheme}
          c={c}
          testID="theme-toggle-button"
        />
        <GhostButton
          label="Settings"
          icon={<Ionicons name="settings-outline" size={16} color={c.text} />}
          onPress={() => navigation.navigate('ServerSetup')}
          c={c}
          testID="settings-button"
        />
        <View
          style={{
            marginTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: radii.sm,
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: radii.pill,
              backgroundColor: c.bgActive,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: fonts.sansMedium, fontSize: 12, color: c.text }}>
              {(appState.user?.username?.[0] ?? '').toUpperCase()}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{ flex: 1, marginLeft: 10, fontFamily: fonts.sansMedium, fontSize: 14, color: c.text }}
            testID="status-rail-user"
          >
            @{appState.user?.username ?? ''}
          </Text>
          <Pressable
            testID="logout-button"
            accessibilityRole="button"
            onPress={appState.logout}
            hitSlop={6}
            style={({ pressed }) => ({
              borderRadius: radii.sm,
              paddingHorizontal: 10,
              paddingVertical: 5,
              backgroundColor: pressed ? c.bgHover : 'transparent',
            })}
          >
            <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, color: c.textDim }}>
              Log out
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function EmptyList({ c }: { c: ThemeColors }) {
  return (
    <View style={{ padding: 32, alignItems: 'center' }} testID="empty-register">
      <Text
        style={{
          textAlign: 'center',
          fontFamily: fonts.sans,
          fontSize: 13.5,
          lineHeight: 21,
          color: c.textDim,
        }}
      >
        No chats yet. Start a new chat to begin.
      </Text>
    </View>
  );
}

/** A rounded title row with a quiet hover-revealed-style delete control. */
function SessionRow({
  index,
  session,
  c,
  onTap,
  onDelete,
}: {
  index: number;
  session: ChatSessionSummary;
  c: ThemeColors;
  onTap: () => void;
  onDelete: () => void;
}) {
  return (
    <Pressable
      onPress={onTap}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: radii.sm,
        backgroundColor: pressed ? c.bgActive : 'transparent',
      })}
      testID={`session-row-${index}`}
    >
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontFamily: fonts.sans, fontSize: 14, color: c.text }}
      >
        {session.title}
      </Text>
      <Pressable
        testID="delete-session-button"
        accessibilityRole="button"
        accessibilityLabel="Delete"
        onPress={onDelete}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 28,
          height: 28,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radii.sm,
          backgroundColor: pressed ? c.dangerSoft : 'transparent',
        })}
      >
        <Ionicons name="close" size={16} color={c.textFaint} />
      </Pressable>
    </Pressable>
  );
}
