import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { fonts, radii, type ThemeColors } from '../theme/design';

/**
 * Shared widgets — the React Native port of the web frontend's recurring
 * chrome (public/style.css): the amber brand mark, the round status dot,
 * the pulsing typing dots, the blinking stream caret, rounded banners, and
 * the auth fact strip.
 */

/**
 * Testability / reduced-motion hook: with EXPO_PUBLIC_E2E=1 baked into the
 * bundle, the signature looping animations (stream caret, breathing dot,
 * pulsing typing dots) render statically. The loops invalidate the window
 * every frame, which makes `uiautomator dump` fail with "could not get idle
 * state" — the adb-driven E2E suite in e2e/flow.mjs relies on that dump.
 */
export const E2E_STATIC = process.env.EXPO_PUBLIC_E2E === '1';

/**
 * The brand sigil: a square frame around a `>` prompt and a block cursor,
 * drawn as a stroke — the same SVG the web frontend ships as its favicon,
 * titlebar and auth-page mark, in the scarce amber brand color.
 */
export function BrandMark({ size = 16, color }: { size?: number; color: string }) {
  const scale = size / 24;
  const strokeWidth = 1.75 * scale;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect
        x={3}
        y={3}
        width={18}
        height={18}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M7 9 L10 12 L7 15"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line
        x1={13}
        y1={15}
        x2={17}
        y2={15}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export type LedState = 'ok' | 'bad' | 'idle';

/**
 * Round status dot — green breathes quietly while the server is reachable,
 * red is solid when it is not, gray while unknown. The `.status-dot` from
 * style.css.
 */
export function StatusDot({ state, c }: { state: LedState; c: ThemeColors }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'ok' || E2E_STATIC) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 1300,
          easing: Easing.inOut(Easing.linear),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.linear),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, opacity]);

  const color = state === 'ok' ? c.success : state === 'bad' ? c.danger : c.textFaint;
  return (
    <Animated.View
      style={{ width: 8, height: 8, borderRadius: radii.pill, backgroundColor: color, opacity }}
    />
  );
}

/**
 * Waiting on the first token: three softly pulsing round dots — the
 * `.typing-dots` from style.css.
 */
export function TypingDots({ c }: { c: ThemeColors }) {
  const dots = useRef([
    new Animated.Value(0.3),
    new Animated.Value(0.3),
    new Animated.Value(0.3),
  ]).current;

  useEffect(() => {
    if (E2E_STATIC) return;
    // 1.2s cycle (rise 400ms, fall 400ms, rest 400ms), phase-shifted 200ms
    // per dot, matching the CSS animation-delay steps.
    const loops = dots.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(value, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.linear),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.3,
            duration: 400,
            easing: Easing.inOut(Easing.linear),
            useNativeDriver: true,
          }),
          Animated.delay(400),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View style={styles.dotsRow} testID="typing-dots">
      {dots.map((value, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: radii.pill,
            backgroundColor: c.textFaint,
            opacity: value,
            marginRight: 6,
          }}
        />
      ))}
    </View>
  );
}

/** Blinking caret on the streaming turn, in ink color — 2px wide, like the
 *  `.msg-row.streaming .msg-content::after` caret from style.css. */
export function StreamCaret({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (E2E_STATIC) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(530),
        Animated.timing(opacity, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(530),
        Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{ width: 2, height: 18, marginLeft: 3, backgroundColor: color, opacity }}
      testID="stream-caret"
    />
  );
}

/**
 * Rounded banner: danger by default (soft red ground, red hairline, red
 * text), advisory keeps the brand edge on the plain canvas — the
 * `.error-banner` / `.migration-banner` pairing from style.css.
 */
export function Banner({
  message,
  advisory = false,
  c,
  testID,
}: {
  message: string;
  advisory?: boolean;
  c: ThemeColors;
  testID?: string;
}) {
  return (
    <View
      testID={testID ?? 'console-banner'}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: advisory ? c.bg : c.dangerSoft,
        borderWidth: 1,
        borderColor: advisory ? c.border : c.dangerLine,
        borderLeftWidth: advisory ? 3 : 1,
        borderLeftColor: advisory ? c.brand : c.dangerLine,
        borderRadius: radii.md,
        flexDirection: 'row',
        alignItems: 'flex-start',
      }}
    >
      <Ionicons
        name={advisory ? 'information-circle-outline' : 'warning-outline'}
        size={15}
        color={advisory ? c.brand : c.danger}
        style={{ marginTop: 2 }}
      />
      <Text
        style={{
          flex: 1,
          marginLeft: 8,
          fontFamily: fonts.sans,
          fontSize: 13,
          lineHeight: 20,
          color: advisory ? c.textDim : c.danger,
        }}
      >
        {message}
      </Text>
    </View>
  );
}

/**
 * The "Local SQLite / scrypt hashed / No network" fact strip from the auth
 * screens — round green dots with quiet sans text, centered.
 */
export function AuthMeta({ c }: { c: ThemeColors }) {
  const items = ['Local SQLite', 'scrypt hashed', 'No network'];
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, rowGap: 4 }}
    >
      {items.map((item) => (
        <View key={item} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 6, height: 6, borderRadius: radii.pill, backgroundColor: c.success }} />
          <Text
            style={{ marginLeft: 6, fontFamily: fonts.sans, fontSize: 12.5, color: c.textDim }}
          >
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dotsRow: { flexDirection: 'row', alignItems: 'center', height: 24 },
});
