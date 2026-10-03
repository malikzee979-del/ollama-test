/// Plain data classes mirroring the shapes returned by the Ollama Chat
/// server's JSON API (see server.js / README.md "API routes"). Kept
/// deliberately simple — no codegen, hand-written fromJson/toJson.
library;

class ChatUser {
  final String id;
  final String username;

  ChatUser({required this.id, required this.username});

  factory ChatUser.fromJson(Map<String, dynamic> json) {
    return ChatUser(
      id: json['id'].toString(),
      username: json['username'] as String,
    );
  }
}

class ChatMessage {
  final String role; // 'user' | 'assistant' | 'system'
  String content;
  final String? model;

  ChatMessage({required this.role, required this.content, this.model});

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      role: json['role'] as String,
      content: json['content'] as String? ?? '',
      model: json['model'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'role': role,
        'content': content,
        if (model != null) 'model': model,
      };
}

class ChatSessionSummary {
  final String id;
  final String title;
  final String updatedAt;

  ChatSessionSummary({
    required this.id,
    required this.title,
    required this.updatedAt,
  });

  factory ChatSessionSummary.fromJson(Map<String, dynamic> json) {
    return ChatSessionSummary(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'New chat',
      updatedAt: json['updatedAt'] as String? ?? '',
    );
  }
}

class ChatSessionFull {
  final String id;
  final String title;
  final List<ChatMessage> messages;

  ChatSessionFull({
    required this.id,
    required this.title,
    required this.messages,
  });

  factory ChatSessionFull.fromJson(Map<String, dynamic> json) {
    final rawMessages = (json['messages'] as List<dynamic>? ?? []);
    return ChatSessionFull(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'New chat',
      messages: rawMessages
          .map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
          .toList(),
    );
  }
}
