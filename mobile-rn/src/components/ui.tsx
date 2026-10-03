import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { claimInputFocus, releaseInputFocus } from '../state/inputFocus';
import { fonts, labelStyle, radii, type ThemeColors } from '../theme/design';

/**
 * UI primitives for the conversational-assistant idiom — the React Native
 * equivalents of the web frontend's .field, .btn-primary, .btn-ghost and
 * .icon-btn: labeled rounded inputs on the canvas, a near-black primary
 * button, and quiet ghost/icon buttons that tint on press.
 */

export function Field({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  secureTextEntry = false,
  placeholder,
  helper,
  c,
  testID,
  autoCapitalize = 'none',
  keyboardType = 'default',
  returnKeyType,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  secureTextEntry?: boolean;
  placeholder?: string;
  helper?: string;
  c: ThemeColors;
  testID?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'url';
  returnKeyType?: 'done' | 'next' | 'go';
  multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<TextInput>(null);
  return (
    <View>
      <Text style={labelStyle(c.textDim)}>{label}</Text>
      <View
        style={{
          marginTop: 6,
          backgroundColor: c.bg,
          borderWidth: 1,
          borderColor: focused ? c.text : c.borderStrong,
          borderRadius: radii.sm,
        }}
      >
        <TextInput
          ref={ref}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          onBlur={() => {
            setFocused(false);
            if (ref.current) releaseInputFocus(ref.current);
          }}
          onFocus={() => {
            setFocused(true);
            if (ref.current) claimInputFocus(ref.current);
          }}
          secureTextEntry={secureTextEntry}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          multiline={multiline}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontFamily: fonts.sans,
            fontSize: 14,
            color: c.text,
          }}
        />
      </View>
      {helper != null && (
        <Text
          style={{
            marginTop: 6,
            fontFamily: fonts.sans,
            fontSize: 12,
            lineHeight: 18,
            color: c.textFaint,
          }}
        >
          {helper}
        </Text>
      )}
    </View>
  );
}

/** The primary action: near-black (near-white in dark) rounded button. */
export function PrimaryButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  c,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  c: ThemeColors;
  testID?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => ({
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
        backgroundColor: pressed && !off ? c.btnPrimaryBgHover : c.btnPrimaryBg,
        opacity: off ? 0.45 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={c.btnPrimaryFg} />
      ) : (
        <Text
          style={{
            fontFamily: fonts.sansMedium,
            fontSize: 15,
            color: c.btnPrimaryFg,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Quiet ghost button: transparent, tints on press, optional hairline. */
export function GhostButton({
  label,
  icon,
  onPress,
  c,
  testID,
  accessibilityLabel,
  bordered = false,
  style,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  c: ThemeColors;
  testID?: string;
  accessibilityLabel?: string;
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 36,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingHorizontal: 10,
          borderRadius: radii.sm,
          borderWidth: bordered ? 1 : 0,
          borderColor: bordered ? c.border : 'transparent',
          backgroundColor: pressed ? c.bgHover : 'transparent',
        },
        style,
      ]}
    >
      {icon}
      <Text
        style={{
          marginLeft: icon ? 8 : 0,
          fontFamily: fonts.sans,
          fontSize: 14,
          color: c.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Square-ish icon button: faint glyph, tints on press — the .icon-btn. */
export function IconButton({
  icon,
  onPress,
  c,
  testID,
  accessibilityLabel,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  c: ThemeColors;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.sm,
        backgroundColor: pressed ? c.bgHover : 'transparent',
      })}
    >
      {icon}
    </Pressable>
  );
}
