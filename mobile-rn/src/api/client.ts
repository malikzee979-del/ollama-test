import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ChatMessage, ChatSessionFull, ChatSessionSummary, ChatUser } from '../models';

/**
 * Thrown for any non-2xx response, carrying the server's `{ error }` message
 * when available so screens can show something useful.
 */
export class ApiException extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiException';
    this.statusCode = statusCode;
  }
}

const SERVER_URL_KEY = 'server_url';
const THEME_MODE_KEY = 'theme_mode';

function stripTrailingSlashes(value: string): string {
  let result = value;
  while (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

/**
 * Talks to the existing Express server (see ../../server.js) over plain
 * HTTP(S). This is the React Native port of mobile/lib/api_client.dart, with
 * one deliberate difference in auth plumbing: the Flutter client captured the
 * opaque `sid` session cookie from the `Set-Cookie` header by hand (native
 * HTTP clients can read it), but React Native's fetch cannot — the response
 * headers never expose `Set-Cookie`. Instead we lean on what the platform
 * gives us: RN's networking layer stores and resends cookies automatically
 * through the native cookie jars (NSHTTPCookieStorage on iOS, webkit
 * CookieManager on Android), and both persist across app launches — so the
 * user stays logged in without any manual bookkeeping. Cookies are also
 * host-scoped by the jar itself, which is exactly the property the Flutter
 * client reproduced manually when the server URL changed.
 *
 * The only state we persist ourselves is the configured server URL; login
 * state is derived from `GET /api/auth/me` (a public route), which is the
 * server's own source of truth for whether our cookie is still valid.
 */
export class ApiClient {
  baseUrl: string | null = null;

  static async load(): Promise<ApiClient> {
    const client = new ApiClient();
    client.baseUrl = await AsyncStorage.getItem(SERVER_URL_KEY);
    return client;
  }

  get isConfigured(): boolean {
    return this.baseUrl != null && this.baseUrl.length > 0;
  }

  async setServerUrl(url: string): Promise<void> {
    const normalized = stripTrailingSlashes(url.trim());
    this.baseUrl = normalized;
    await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
    // No cookie cleanup needed here (unlike the Dart client): the native
    // cookie jars scope cookies per host, so a session from the previous
    // server is never sent to the new one.
  }

  private uri(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private jsonHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  private async decodeOrThrow(res: Response): Promise<Record<string, unknown> | null> {
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      if (text.length > 0) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Non-JSON body (e.g. an HTML error page) — fall through to the
      // generic message below.
    }
    if (!res.ok) {
      const message =
        typeof body?.error === 'string' ? body.error : `Request failed with status ${res.status}.`;
      throw new ApiException(res.status, message);
    }
    return body;
  }

  /**
   * Basic reachability check against the always-public `/api/auth/me` route —
   * used by the server-setup screen to validate a URL *before* saving it,
   * without requiring login first. Takes the candidate URL directly rather
   * than using [baseUrl], so a bad URL never gets persisted just because it
   * happened to be checked.
   */
  async pingUrl(url: string): Promise<void> {
    const normalized = stripTrailingSlashes(url.trim());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${normalized}/api/auth/me`, { signal: controller.signal });
      await this.decodeOrThrow(res);
    } finally {
      clearTimeout(timer);
    }
  }

  async signup(username: string, password: string): Promise<ChatUser> {
    const res = await fetch(this.uri('/api/auth/signup'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const body = await this.decodeOrThrow(res);
    return (body as { user: ChatUser }).user;
  }

  async login(username: string, password: string): Promise<ChatUser> {
    const res = await fetch(this.uri('/api/auth/login'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const body = await this.decodeOrThrow(res);
    return (body as { user: ChatUser }).user;
  }

  async logout(): Promise<void> {
    try {
      await fetch(this.uri('/api/auth/logout'), {
        method: 'POST',
        headers: this.jsonHeaders(),
        credentials: 'include',
      });
    } catch {
      // Best effort — mirrors the Dart client's try/finally: the server-side
      // session is invalidated when reachable; the locally stored cookie (if
      // any survived) is dead either way.
    }
  }

  async me(): Promise<ChatUser | null> {
    const res = await fetch(this.uri('/api/auth/me'), {
      headers: this.jsonHeaders(),
      credentials: 'include',
    });
    const body = await this.decodeOrThrow(res);
    const user = (body as { user?: ChatUser | null })?.user;
    return user ?? null;
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(this.uri('/api/models'), { credentials: 'include' });
    const body = await this.decodeOrThrow(res);
    const models = ((body as { models?: Array<{ name: string }> })?.models ?? []);
    return models.map((m) => m.name);
  }

  async listSessions(): Promise<ChatSessionSummary[]> {
    const res = await fetch(this.uri('/api/sessions'), { credentials: 'include' });
    const body = await this.decodeOrThrow(res);
    const sessions = ((body as { sessions?: Array<Record<string, unknown>> })?.sessions ?? []);
    return sessions.map((s) => ({
      id: s.id as string,
      title: typeof s.title === 'string' ? s.title : 'New chat',
      updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : '',
    }));
  }

  async createSession(title?: string): Promise<ChatSessionFull> {
    const res = await fetch(this.uri('/api/sessions'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      credentials: 'include',
      body: JSON.stringify(title != null ? { title } : {}),
    });
    const body = await this.decodeOrThrow(res);
    return sessionFromJson(body as Record<string, unknown>);
  }

  async getSession(id: string): Promise<ChatSessionFull> {
    const res = await fetch(this.uri(`/api/sessions/${id}`), { credentials: 'include' });
    const body = await this.decodeOrThrow(res);
    return sessionFromJson(body as Record<string, unknown>);
  }

  async appendMessages(sessionId: string, messages: ChatMessage[], title?: string): Promise<void> {
    const res = await fetch(this.uri(`/api/sessions/${sessionId}`), {
      method: 'PATCH',
      headers: this.jsonHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        ...(title != null ? { title } : {}),
        appendMessages: messages.map(messageToJson),
      }),
    });
    await this.decodeOrThrow(res);
  }

  async deleteSession(id: string): Promise<void> {
    const res = await fetch(this.uri(`/api/sessions/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    });
    await this.decodeOrThrow(res);
  }

  /**
   * Streams an assistant reply for `messages` against `model`, yielding each
   * incremental content delta as it arrives from the server's newline-
   * delimited JSON `/api/chat` proxy (see server.js). Mirrors the web
   * frontend's parsing in public/app.js and the Dart client's chatStream.
   *
   * Cancellation: pass an AbortSignal (Stop button) — aborting rejects the
   * stream read with an AbortError, which callers treat like the Dart
   * client-close path.
   */
  async *chatStream(
    model: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const res = await fetch(this.uri('/api/chat'), {
      method: 'POST',
      headers: this.jsonHeaders(),
      credentials: 'include',
      signal,
      body: JSON.stringify({ model, messages: messages.map(messageToJson), stream: true }),
    });

    if (!res.ok) {
      let message = `Chat request failed (${res.status}).`;
      try {
        const decoded = JSON.parse(await res.text()) as { error?: string };
        if (typeof decoded.error === 'string') message = decoded.error;
      } catch {
        /* non-JSON error body — keep the generic message */
      }
      throw new ApiException(res.status, message);
    }

    // React Native >= 0.73 exposes the fetch response body as a Web
    // ReadableStream; read it incrementally and split NDJSON lines as they
    // arrive. If a runtime ever lacks streaming support, degrade to reading
    // the whole body at once (same parsing, no incremental deltas).
    const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader?.();
    if (!reader) {
      for (const line of (await res.text()).split('\n')) {
        const content = contentFromNdjsonLine(line);
        if (content) yield content;
      }
      return;
    }

    const utf8 = new Utf8Decoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += utf8.decode(value);
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        const content = contentFromNdjsonLine(line);
        if (content) yield content;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail) {
      const content = contentFromNdjsonLine(tail);
      if (content) yield content;
    }
  }
}

function messageToJson(m: ChatMessage): Record<string, unknown> {
  return { role: m.role, content: m.content, ...(m.model != null ? { model: m.model } : {}) };
}

function sessionFromJson(json: Record<string, unknown>): ChatSessionFull {
  const rawMessages = (json.messages as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id: json.id as string,
    title: typeof json.title === 'string' ? json.title : 'New chat',
    messages: rawMessages.map((m) => ({
      role: m.role as ChatMessage['role'],
      content: typeof m.content === 'string' ? m.content : '',
      ...(typeof m.model === 'string' ? { model: m.model } : {}),
    })),
  };
}

/** Extracts `message.content` from one NDJSON line; null for anything else. */
function contentFromNdjsonLine(line: string): string | null {
  if (!line) return null;
  try {
    const json = JSON.parse(line) as { message?: { content?: string } };
    const content = json.message?.content;
    return typeof content === 'string' && content.length > 0 ? content : null;
  } catch {
    // Ignore malformed lines rather than aborting the stream.
    return null;
  }
}

/**
 * Minimal streaming UTF-8 decoder: TextDecoder is not guaranteed in every
 * Hermes build, and chat deltas can split a multi-byte sequence across two
 * chunks — naive per-chunk String.fromCharCode would corrupt them.
 */
class Utf8Decoder {
  private pending: number[] = [];

  decode(chunk: Uint8Array): string {
    const bytes: number[] = this.pending.length > 0 ? this.pending.concat(Array.from(chunk)) : Array.from(chunk);
    this.pending = [];
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let len: number;
      if (b < 0x80) len = 1;
      else if ((b & 0xe0) === 0xc0) len = 2;
      else if ((b & 0xf0) === 0xe0) len = 3;
      else if ((b & 0xf8) === 0xf0) len = 4;
      else {
        // Invalid leading byte — emit replacement and move on.
        out += '\uFFFD';
        i += 1;
        continue;
      }
      if (i + len > bytes.length) {
        // Sequence continues in the next chunk.
        this.pending = bytes.slice(i);
        break;
      }
      const seq = bytes.slice(i, i + len);
      i += len;
      if (seq.slice(1).some((c) => (c & 0xc0) !== 0x80)) {
        out += '\uFFFD';
        continue;
      }
      let cp: number;
      if (len === 1) cp = seq[0];
      else if (len === 2) cp = ((seq[0] & 0x1f) << 6) | (seq[1] & 0x3f);
      else if (len === 3) cp = ((seq[0] & 0x0f) << 12) | ((seq[1] & 0x3f) << 6) | (seq[2] & 0x3f);
      else cp = ((seq[0] & 0x07) << 18) | ((seq[1] & 0x3f) << 12) | ((seq[2] & 0x3f) << 6) | (seq[3] & 0x3f);
      out += String.fromCodePoint(cp);
    }
    return out;
  }
}

export { THEME_MODE_KEY };
