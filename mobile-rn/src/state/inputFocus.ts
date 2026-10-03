import type { TextInput } from 'react-native';

/**
 * Tracks which text input currently holds focus. `Keyboard.isVisible()` is
 * not a reliable signal on Android — a `uiautomator dump` (used by the e2e
 * harness) triggers spurious hide events while the IME is still up — but
 * view focus is exact, so the global BACK handler consults this registry to
 * decide whether BACK should dismiss the keyboard instead of navigating.
 */
let current: TextInput | null = null;

export function claimInputFocus(input: TextInput) {
  current = input;
}

export function releaseInputFocus(input: TextInput) {
  if (current === input) current = null;
}

export function focusedInput(): TextInput | null {
  return current;
}
