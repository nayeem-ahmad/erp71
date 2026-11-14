import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/providers.dart';
import '../../core/voice/voice_recorder.dart';
import 'ask_draft.dart';

class AskMessage {
  const AskMessage({
    required this.fromMe,
    required this.text,
    this.id,
    this.credits,
    this.truncated = false,
    this.drafts = const [],
  });

  final bool fromMe;
  final String text;

  /// The server's id, used to keep a draft card's edits across rebuilds.
  final String? id;

  /// Credits the answer cost, as the server counted them.
  final num? credits;

  /// The answer was cut short (the model hit its length or step limit).
  final bool truncated;

  /// Task or lead cards under this reply. Empty for the person's own messages.
  final List<AskDraft> drafts;
}

class AskState {
  const AskState({
    this.messages = const [],
    this.conversationId,
    this.sending = false,
    this.bangla = false,
    this.tools,
    this.toolsReady = false,
  });

  final List<AskMessage> messages;
  final String? conversationId;
  final bool sending;

  /// Ask and hear in Bangla rather than English.
  final bool bangla;

  /// Names from GET /ai/chat/tools. Null until [toolsReady].
  final Set<String>? tools;
  final bool toolsReady;

  String get locale => bangla ? 'bn' : 'en';

  /// The recognizer's name for the same language.
  String get speechLocale => bangla ? 'bn_BD' : 'en_US';

  AskState copyWith({
    List<AskMessage>? messages,
    String? conversationId,
    bool? sending,
    bool? bangla,
    Set<String>? tools,
    bool? toolsReady,
  }) => AskState(
    messages: messages ?? this.messages,
    conversationId: conversationId ?? this.conversationId,
    sending: sending ?? this.sending,
    bangla: bangla ?? this.bangla,
    tools: tools ?? this.tools,
    toolsReady: toolsReady ?? this.toolsReady,
  );
}

/// Better Bangla is off until this person turns it on, and it stays off across
/// a fresh launch. While it is on, the microphone records and sends audio.
final betterBanglaProvider = NotifierProvider<BetterBanglaController, bool>(
  BetterBanglaController.new,
);

class BetterBanglaController extends Notifier<bool> {
  @override
  bool build() => false;

  void setEnabled(bool value) => state = value;
}

/// A conversation with the assistant over POST /ai/chat, the same endpoint and
/// the same tools the web's assistant uses: it reads only what this member's
/// permissions let it, and every answer spends the workspace's AI credits.
final askProvider = NotifierProvider.autoDispose<AskController, AskState>(
  AskController.new,
);

class AskController extends Notifier<AskState> {
  int _toolsToken = 0;

  @override
  AskState build() {
    // A different workspace is a different conversation.
    ref.watch(activeWorkspaceProvider.select((w) => w?.id));
    final token = ++_toolsToken;
    Future.microtask(() => _loadTools(token));
    return const AskState();
  }

  ApiClient get _api => ref.read(apiClientProvider);

  void setBangla(bool value) => state = state.copyWith(bangla: value);

  /// Starts over: the next question opens a new conversation.
  /// The tool list is loaded again so a permission change is picked up.
  void reset() {
    state = AskState(bangla: state.bangla);
    _loadTools(++_toolsToken);
  }

  Future<void> _loadTools(int token) async {
    try {
      final data = await _api.get('/ai/chat/tools');
      if (!ref.mounted || token != _toolsToken) return;
      state = state.copyWith(tools: _toolNames(data), toolsReady: true);
    } catch (_) {
      if (!ref.mounted || token != _toolsToken) return;
      // Unknown means no cards. Chat itself still works.
      state = state.copyWith(tools: const {}, toolsReady: true);
    }
  }

  /// Whisper for Better Bangla. The words come back for the person to check;
  /// this does not send the question.
  Future<({String transcript, num credits})> transcribe(
    RecordedAudio clip,
  ) async {
    final data = await _api.post(
      '/ai/transcribe',
      body: {
        'audioBase64': clip.base64,
        'audioFormat': clip.format,
        'locale': 'bn',
      },
    );
    if (data is! Map) {
      throw const ApiException(
        statusCode: 502,
        message: 'ERP71 sent a response the app could not read.',
      );
    }
    final credits = data['credits_used'];
    return (
      transcript: (data['transcript'] as String? ?? '').trim(),
      credits: credits is num ? credits : 0,
    );
  }

  /// POST /project-tasks with the person's own token. Returns the new id.
  Future<String?> saveTask(Map<String, Object?> body) async =>
      _createdId(await _api.post('/project-tasks', body: body));

  /// POST /crm/leads. The owner is whoever saves; the body names no one.
  Future<String?> saveLead(Map<String, Object?> body) async =>
      _createdId(await _api.post('/crm/leads', body: body));

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
            id: message['id'] as String?,
            fromMe: false,
            text: (message['content'] as String? ?? '').trim(),
            credits: reply['credits_used'] as num?,
            truncated: reply['truncated'] == true,
            drafts: parseDrafts(message['tool_calls']),
          ),
        ],
      );
    } catch (_) {
      if (ref.mounted) state = state.copyWith(sending: false);
      rethrow;
    }
  }
}

Set<String> _toolNames(Object? data) {
  if (data is! Map) return const {};
  final tools = data['tools'];
  if (tools is! List) return const {};
  return {
    for (final name in tools)
      if (name is String) name,
  };
}

String? _createdId(Object? created) {
  if (created is Map && created['id'] != null) return '${created['id']}';
  return null;
}
