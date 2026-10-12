import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/providers.dart';

class AskMessage {
  const AskMessage({
    required this.fromMe,
    required this.text,
    this.credits,
    this.truncated = false,
  });

  final bool fromMe;
  final String text;

  /// Credits the answer cost, as the server counted them.
  final num? credits;

  /// The answer was cut short (the model hit its length or step limit).
  final bool truncated;
}

class AskState {
  const AskState({
    this.messages = const [],
    this.conversationId,
    this.sending = false,
    this.bangla = false,
  });

  final List<AskMessage> messages;
  final String? conversationId;
  final bool sending;

  /// Ask and hear in Bangla rather than English.
  final bool bangla;

  String get locale => bangla ? 'bn' : 'en';

  /// The recognizer's name for the same language.
  String get speechLocale => bangla ? 'bn_BD' : 'en_US';

  AskState copyWith({
    List<AskMessage>? messages,
    String? conversationId,
    bool? sending,
    bool? bangla,
  }) => AskState(
    messages: messages ?? this.messages,
    conversationId: conversationId ?? this.conversationId,
    sending: sending ?? this.sending,
    bangla: bangla ?? this.bangla,
  );
}

/// A conversation with the assistant over POST /ai/chat, the same endpoint and
/// the same tools the web's assistant uses: it reads only what this member's
/// permissions let it, and every answer spends the workspace's AI credits.
final askProvider = NotifierProvider.autoDispose<AskController, AskState>(
  AskController.new,
);

class AskController extends Notifier<AskState> {
  @override
  AskState build() {
    // A different workspace is a different conversation.
    ref.watch(activeWorkspaceProvider.select((w) => w?.id));
    return const AskState();
  }

  ApiClient get _api => ref.read(apiClientProvider);

  void setBangla(bool value) => state = state.copyWith(bangla: value);

  /// Starts over: the next question opens a new conversation.
  void reset() => state = AskState(bangla: state.bangla);

  /// Throws the server's refusal (no credits, assistant switched off) for the
  /// screen to show; the question stays on screen either way.
  Future<void> send(String text) async {
    final question = text.trim();
    if (question.isEmpty || state.sending) return;
    state = state.copyWith(
      messages: [
        ...state.messages,
        AskMessage(fromMe: true, text: question),
      ],
      sending: true,
    );
    try {
      final reply =
          await _api.post(
                '/ai/chat',
                body: {
                  'message': question,
                  'conversationId': ?state.conversationId,
                  'locale': state.locale,
                },
              )
              as Map<String, dynamic>;
      if (!ref.mounted) return;
      final message = reply['message'] as Map<String, dynamic>? ?? const {};
      state = state.copyWith(
        conversationId: reply['conversation_id'] as String?,
        sending: false,
        messages: [
          ...state.messages,
          AskMessage(
            fromMe: false,
            text: (message['content'] as String? ?? '').trim(),
            credits: reply['credits_used'] as num?,
            truncated: reply['truncated'] == true,
          ),
        ],
      );
    } catch (_) {
      if (ref.mounted) state = state.copyWith(sending: false);
      rethrow;
    }
  }
}
