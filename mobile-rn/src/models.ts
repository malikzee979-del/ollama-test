// Plain data types mirroring the shapes returned by the Ollama Chat server's
// JSON API (see ../../server.js / README.md "API routes") — the React Native
// port of mobile/lib/models.dart.

export interface ChatUser {
  id: string;
  username: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatSessionFull {
  id: string;
  title: string;
  messages: ChatMessage[];
}
