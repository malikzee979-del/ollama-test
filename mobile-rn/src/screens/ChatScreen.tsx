import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiException } from '../api/client';
import { IconButton } from '../components/ui';
import { Banner, BrandMark, StreamCaret, TypingDots } from '../components/widgets';
import type { ChatMessage } from '../models';
import type { RootStackParamList } from '../navigation';
import { useAppState } from '../state/AppStateContext';
import { claimInputFocus, releaseInputFocus } from '../state/inputFocus';
import { fonts, radii, type ThemeColors } from '../theme/design';
import { useTheme } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

/**
 * The transcript + composer — the conversational-assistant idiom from the
 * web frontend: one centered column, user turns as rounded bubbles set to
 * the right, assistant turns as plain prose (no avatars, no separators),
 * and a pill-shaped composer with a circular send key.
 */
export function ChatScreen({ route, navigation }: Props) {
  const appState = useAppState();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { sessionId } = route.params;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(route.params.initialTitle);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const composerRef = useRef<TextInput>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Keep the latest messages visible to the streaming loop without
  // re-creating it on every delta.
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [session, modelList] = await Promise.all([
          appState.client.getSession(sessionId),
          appState.client.listModels(),
        ]);
        if (cancelled) return;
        setMessages(session.messages);
        setTitle(session.title);
        setModels(modelList);
        setSelectedModel(modelList.length > 0 ? modelList[0] : null);
        setLoadingSession(false);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiException ? err.message : `Could not load this chat: ${err}`,
        );
        setLoadingSession(false);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [appState.client, sessionId]);

  const scrollToBottom = useCallback(() => {
    // Defer to after the state update renders.
    setTimeout(() => {
      const list = listRef.current;
      if (list) list.scrollToEnd({ animated: true });
    }, 30);
  }, []);

  const send = async () => {
    const text = draft.trim();
    if (text.length === 0 || selectedModel == null || sending) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const assistantMessage: ChatMessage = { role: 'assistant', content: '', model: selectedModel };
    const next = [...messagesRef.current, userMessage, assistantMessage];
    setMessages(next);
    setDraft('');
    setSending(true);
    scrollToBottom();

    // Send full prior history (excluding the empty assistant placeholder we
    // just added) so the model has context, same as the web frontend.
    const history = next.slice(0, next.length - 1);
    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (updater: (prev: string) => string) => {
      setMessages((current) =>
        current.map((m, i) =>
          i === current.length - 1 ? { ...m, content: updater(m.content) } : m,
        ),
      );
    };

    try {
      const stream = appState.client.chatStream(selectedModel, history, controller.signal);
      for await (const delta of stream) {
        patchAssistant((prev) => prev + delta);
        scrollToBottom();
      }
    } catch (err) {
      const message = err instanceof ApiException ? err.message : `${err}`;
      patchAssistant((prev) =>
        prev.length === 0 ? `Error: ${message}` : `${prev}\n\n_[stopped: ${message}]_`,
      );
    } finally {
      abortRef.current = null;
      setSending(false);
    }

    // Persist this turn regardless of how the stream ended — success,
    // error, or a Stop tap (same fix the Dart screen carries). Best-effort:
    // if persistence fails too, the turn stays visible in-memory only.
    try {
      const finalContent = messagesRef.current[messagesRef.current.length - 1]?.content ?? '';
      await appState.client.appendMessages(sessionId, [
        userMessage,
        { ...assistantMessage, content: finalContent },
      ]);
    } catch {
      /* best-effort */
    }
  };

  const stop = () => {
    abortRef.current?.abort();
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

  const canSend = draft.trim().length > 0 && selectedModel != null && !sending;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* Minimal top bar: back, then the model picker. No border — the
          canvas tint does the separating, like the web topbar. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingTop: insets.top + 4,
          paddingBottom: 4,
        }}
      >
        <IconButton
          testID="chat-back-button"
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          icon={<Ionicons name="arrow-back" size={20} color={c.textFaint} />}
          c={c}
        />
        {models.length === 0 ? (
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: fonts.sansSemiBold, fontSize: 15, color: c.text }}
          >
            {title}
          </Text>
        ) : (
          <Pressable
            testID="model-picker-button"
            accessibilityRole="button"
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 7,
              borderRadius: radii.sm,
              backgroundColor: pressed ? c.bgHover : 'transparent',
            })}
          >
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: fonts.sansSemiBold,
                fontSize: 15,
                color: c.text,
              }}
              testID="selected-model-label"
            >
              {selectedModel ?? title}
            </Text>
            <Ionicons name="chevron-down" size={14} color={c.textFaint} style={{ marginLeft: 4 }} />
          </Pressable>
        )}
      </View>

      {loadingSession ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={c.textFaint} />
        </View>
      ) : loadError != null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Banner message={loadError} c={c} testID="chat-error-banner" />
        </View>
      ) : (
        <>
          {messages.length === 0 ? (
            <EmptyGreeting c={c} host={hostLabel()} />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(_, i) => String(i)}
              contentContainerStyle={{ paddingBottom: 16 }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item, index }) => {
                const isUser = item.role === 'user';
                const isStreaming = !isUser && sending && index === messages.length - 1;
                const isThinking = isStreaming && item.content.length === 0;
                return (
                  <MessageRow
                    message={item}
                    isUser={isUser}
                    isStreaming={isStreaming}
                    isThinking={isThinking}
                    c={c}
                    testID={isUser ? undefined : 'assistant-message'}
                  />
                );
              }}
            />
          )}

          {/* The floating pill composer. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
          >
            <View
              style={{
                paddingHorizontal: 12,
                paddingTop: 8,
                paddingBottom: 8 + insets.bottom,
                backgroundColor: c.bg,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  backgroundColor: c.bgSurface,
                  borderWidth: 1,
                  borderColor: focused ? c.borderStrong : c.border,
                  borderRadius: 28,
                  paddingLeft: 16,
                  paddingRight: 8,
                  paddingVertical: 4,
                }}
              >
                <TextInput
                  ref={composerRef}
                  testID="chat-input"
                  value={draft}
                  onChangeText={setDraft}
                  onFocus={() => {
                    setFocused(true);
                    if (composerRef.current) claimInputFocus(composerRef.current);
                  }}
                  onBlur={() => {
                    setFocused(false);
                    if (composerRef.current) releaseInputFocus(composerRef.current);
                  }}
                  editable={!sending}
                  multiline
                  placeholder="Message your local model…"
                  placeholderTextColor={c.textFaint}
                  style={{
                    flex: 1,
                    maxHeight: 120,
                    fontFamily: fonts.sans,
                    fontSize: 16,
                    lineHeight: 24,
                    paddingVertical: 6,
                    color: c.text,
                  }}
                />
                <View style={{ width: 8 }} />
                {sending ? (
                  <Pressable
                    testID="stop-button"
                    accessibilityRole="button"
                    accessibilityLabel="Stop"
                    onPress={stop}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: c.btnPrimaryBg,
                      marginBottom: 4,
                    }}
                  >
                    <Ionicons name="stop" size={14} color={c.btnPrimaryFg} />
                  </Pressable>
                ) : (
                  <Pressable
                    testID="send-button"
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    onPress={canSend ? send : undefined}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: canSend ? c.btnPrimaryBg : c.bgActive,
                      marginBottom: 4,
                    }}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={16}
                      color={canSend ? c.btnPrimaryFg : c.textFaint}
                    />
                  </Pressable>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      {/* Model picker sheet: rounded top corners on the canvas. */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}
          onPress={() => setPickerOpen(false)}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: radii.lg,
              borderTopRightRadius: radii.lg,
            }}
          >
            <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
              <Text style={{ fontFamily: fonts.sansSemiBold, fontSize: 16, color: c.text }}>
                Select model
              </Text>
            </View>
            {models.map((m) => {
              const selected = m === selectedModel;
              return (
                <Pressable
                  key={m}
                  testID={`model-option-${m}`}
                  disabled={sending}
                  onPress={() => {
                    setSelectedModel(m);
                    setPickerOpen(false);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginHorizontal: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    borderRadius: radii.sm,
                    backgroundColor: selected ? c.bgSurface : pressed ? c.bgHover : 'transparent',
                  })}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontFamily: fonts.sans,
                      fontSize: 14,
                      color: selected ? c.text : c.textDim,
                    }}
                  >
                    {m}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={16} color={c.text} />}
                </Pressable>
              );
            })}
            <View style={{ height: 8 + insets.bottom }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * User turns: rounded bubble set to the right. Assistant turns: plain
 * full-width prose — no avatars, no role labels, no separators.
 */
function MessageRow({
  message,
  isUser,
  isStreaming,
  isThinking,
  c,
  testID,
}: {
  message: ChatMessage;
  isUser: boolean;
  isStreaming: boolean;
  isThinking: boolean;
  c: ThemeColors;
  testID?: string;
}) {
  const prose = {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 26,
    color: c.text,
  } as const;

  if (isUser) {
    return (
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, alignItems: 'flex-end' }}>
        <View
          style={{
            backgroundColor: c.bgSurface,
            borderRadius: radii.xl,
            paddingHorizontal: 16,
            paddingVertical: 10,
            maxWidth: '82%',
          }}
        >
          <Text style={prose}>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
      {isThinking ? (
        <TypingDots c={c} />
      ) : isStreaming ? (
        <View
          testID={testID}
          style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Text style={prose}>{message.content}</Text>
          <StreamCaret color={c.text} />
        </View>
      ) : (
        <Text testID={testID} style={prose} selectable>
          {message.content}
        </Text>
      )}
    </View>
  );
}

/** A centered greeting, the way a fresh conversation opens on the web. */
function EmptyGreeting({ c, host }: { c: ThemeColors; host: string }) {
  return (
    <View
      style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}
      testID="chat-empty-motd"
    >
      <BrandMark size={36} color={c.brand} />
      <Text
        style={{
          marginTop: 16,
          fontFamily: fonts.sansSemiBold,
          fontSize: 26,
          letterSpacing: -0.52,
          color: c.text,
          textAlign: 'center',
        }}
      >
        Ollama Chat
      </Text>
      <Text
        style={{
          marginTop: 8,
          fontFamily: fonts.sans,
          fontSize: 14,
          lineHeight: 22.4,
          color: c.textDim,
          textAlign: 'center',
        }}
      >
        Pick a model and start typing. Every turn streams straight from the daemon running on
        your own hardware.
      </Text>
      {host.length > 0 && (
        <Text
          style={{
            marginTop: 12,
            fontFamily: fonts.sans,
            fontSize: 12.5,
            color: c.textFaint,
            textAlign: 'center',
          }}
        >
          {host}
        </Text>
      )}
    </View>
  );
}
