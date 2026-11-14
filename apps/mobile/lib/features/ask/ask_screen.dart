import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/access.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/network/online_status.dart';
import '../../core/voice/speech_input.dart';
import '../../core/voice/voice_recorder.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'ask_copy.dart';
import 'ask_data.dart';
import 'ask_draft.dart';
import 'ask_draft_card.dart';

/// Questions to start from, for someone who does not know what to ask yet.
const _suggestions = {
  false: [
    'How are sales today compared with yesterday?',
    'Which customers owe me the most?',
    'What is running low on stock?',
    'Did anything look unusual this week?',
  ],
  true: [
    'আজকের বিক্রি গতকালের তুলনায় কেমন?',
    'কোন গ্রাহকের কাছে সবচেয়ে বেশি বাকি?',
    'কোন পণ্যের স্টক কমে গেছে?',
    'এই সপ্তাহে অস্বাভাবিক কিছু হয়েছে কি?',
  ],
};

/// The assistant button for app bars, shown only where the plan includes AI.
class AskButton extends ConsumerWidget {
  const AskButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    if (workspace == null || !MobileAccess.of(workspace).ask) {
      return const SizedBox.shrink();
    }
    return IconButton(
      tooltip: 'Ask ERP71',
      icon: const Icon(Icons.auto_awesome_outlined),
      onPressed: () => context.push('/ask'),
    );
  }
}

/// Ask about the business in plain English or Bangla, typed or spoken.
/// Spoken words land in the box to be checked and sent by hand.
///
/// The phone's speech recognizer is the default. Better Bangla, off until it
/// is turned on, records a clip and asks Whisper to write it down.
class AskScreen extends ConsumerStatefulWidget {
  const AskScreen({super.key});

  @override
  ConsumerState<AskScreen> createState() => _AskScreenState();
}

class _AskScreenState extends ConsumerState<AskScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  bool _listening = false;
  bool _recording = false;
  bool _transcribing = false;
  bool _whisperBusy = false;

  @override
  void dispose() {
    if (_listening) ref.read(speechInputProvider).stop();
    if (_recording) ref.read(voiceRecorderProvider).stop();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? text]) async {
    final question = (text ?? _input.text).trim();
    if (question.isEmpty || _transcribing) return;
    if (_listening) await _toggleListening();
    if (_recording) {
      // Send means "send what is typed". A clip still recording is discarded,
      // not uploaded and not sent on its own.
      await ref.read(voiceRecorderProvider).stop();
      if (mounted) setState(() => _recording = false);
    }
    _input.clear();
    try {
      await ref.read(askProvider.notifier).send(question);
    } catch (error) {
      // The question is still on screen; put it back in the box to retry.
      if (_input.text.isEmpty) _input.text = question;
      showToast(describeError(error), tone: Tone.danger);
    }
    _toEnd();
  }

  bool get _useWhisper {
    final ask = ref.read(askProvider);
    return ask.bangla && ref.read(betterBanglaProvider);
  }

  Future<void> _toggleMic() async {
    if (_useWhisper) {
      await _toggleWhisper();
      return;
    }
    await _toggleListening();
  }

  Future<void> _toggleListening() async {
    final speech = ref.read(speechInputProvider);
    if (_listening) {
      await speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    final started = await speech.start(
      localeId: ref.read(askProvider).speechLocale,
      onWords: (words, _) {
        if (!mounted) return;
        _input.value = TextEditingValue(
          text: words,
          selection: TextSelection.collapsed(offset: words.length),
        );
      },
      onDone: () {
        if (mounted) setState(() => _listening = false);
      },
    );
    if (!mounted) return;
    if (!started) {
      showToast(AskCopy(ref.read(askProvider).bangla).micUnavailable);
      return;
    }
    setState(() => _listening = true);
  }

  Future<void> _toggleWhisper() async {
    final recorder = ref.read(voiceRecorderProvider);
    if (_recording) {
      await _finishWhisper(recorder);
      return;
    }
    if (_transcribing) return;
    final copy = AskCopy(ref.read(askProvider).bangla);
    if (!ref.read(onlineProvider)) {
      showToast(copy.whisperNeedsNet);
      return;
    }
    final started = await recorder.start(
      onLimit: () {
        if (mounted) _finishWhisper(recorder);
      },
    );
    if (!mounted) {
      if (started) await recorder.stop();
      return;
    }
    if (!started) {
      showToast(copy.micUnavailable);
      return;
    }
    setState(() => _recording = true);
  }

  Future<void> _finishWhisper(VoiceRecorder recorder) async {
    if (_whisperBusy) return;
    _whisperBusy = true;
    setState(() {
      _recording = false;
      _transcribing = true;
    });
    final copy = AskCopy(ref.read(askProvider).bangla);
    try {
      final clip = await recorder.stop();
      if (!mounted) return;
      if (clip == null) {
        showToast(copy.whisperTooShort);
        return;
      }
      if (!ref.read(onlineProvider)) {
        showToast(copy.whisperNeedsNet);
        return;
      }
      final heard = await ref.read(askProvider.notifier).transcribe(clip);
      if (!mounted) return;
      if (heard.transcript.isEmpty) {
        showToast(copy.whisperFailed);
        return;
      }
      _input.value = TextEditingValue(
        text: heard.transcript,
        selection: TextSelection.collapsed(offset: heard.transcript.length),
      );
      showToast(copy.heard(heard.credits));
    } catch (error) {
      if (mounted) showToast(describeError(error), tone: Tone.danger);
    } finally {
      _whisperBusy = false;
      if (mounted) setState(() => _transcribing = false);
    }
  }

  Future<void> _setBangla(bool value) async {
    if (_recording) {
      await ref.read(voiceRecorderProvider).stop();
      if (mounted) setState(() => _recording = false);
    }
    if (_listening) await _toggleListening();
    ref.read(askProvider.notifier).setBangla(value);
  }

  void _toEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(askProvider);
    final controller = ref.read(askProvider.notifier);
    final copy = AskCopy(state.bangla);
    final online = ref.watch(onlineProvider);
    final betterBangla = ref.watch(betterBanglaProvider);
    final workspace = ref.watch(activeWorkspaceProvider);
    final canOpenLead = workspace != null && MobileAccess.of(workspace).crm;
    final micTip = _recording
        ? copy.stopRecording
        : _listening
        ? copy.stopListening
        : copy.speak;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ask ERP71'),
        actions: [
          TextButton(
            onPressed: () => _setBangla(!state.bangla),
            child: Text(state.bangla ? 'English' : 'বাংলা'),
          ),
          if (state.messages.isNotEmpty)
            IconButton(
              tooltip: copy.newConversation,
              icon: const Icon(Icons.add_comment_outlined),
              onPressed: state.sending ? null : controller.reset,
            ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: state.messages.isEmpty
                ? _Suggestions(bangla: state.bangla, onPick: (q) => _send(q))
                : ListView(
                    controller: _scroll,
                    padding: const EdgeInsets.all(12),
                    children: [
                      for (final message in state.messages) ...[
                        _Bubble(message: message, bangla: state.bangla),
                        for (var i = 0; i < message.drafts.length; i++)
                          if (draftIsOffered(
                            state.toolsReady,
                            state.tools,
                            message.drafts[i],
                          ))
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: AskDraftCard(
                                key: ValueKey('${message.id ?? 'draft'}-$i'),
                                draft: message.drafts[i],
                                bangla: state.bangla,
                                online: online,
                                onSave:
                                    message.drafts[i].kind == AskDraftKind.task
                                    ? controller.saveTask
                                    : controller.saveLead,
                                onOpen:
                                    message.drafts[i].kind ==
                                            AskDraftKind.lead &&
                                        canOpenLead
                                    ? (id) => context.go('/leads/$id')
                                    : null,
                              ),
                            ),
                      ],
                      if (state.sending) _Thinking(bangla: state.bangla),
                    ],
                  ),
          ),
          SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (state.bangla)
                  SwitchListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                    title: Text(
                      copy.betterBangla,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: Text(
                      copy.betterBanglaHint,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    value: betterBangla,
                    onChanged: state.sending || _transcribing || _recording
                        ? null
                        : (value) => ref
                              .read(betterBanglaProvider.notifier)
                              .setEnabled(value),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _input,
                          minLines: 1,
                          maxLines: 4,
                          maxLength: 2000,
                          enabled: !_transcribing,
                          buildCounter:
                              (
                                _, {
                                required currentLength,
                                required isFocused,
                                maxLength,
                              }) => null,
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _send(),
                          decoration: InputDecoration(
                            hintText: _transcribing
                                ? copy.transcribing
                                : _recording
                                ? copy.recording
                                : _listening
                                ? copy.listening
                                : copy.askPlaceholder,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: micTip,
                        color: _listening || _recording
                            ? AppColors.danger
                            : AppColors.primary,
                        icon: Icon(
                          _listening || _recording
                              ? Icons.stop_circle
                              : Icons.mic_none,
                        ),
                        onPressed: state.sending || _transcribing
                            ? null
                            : _toggleMic,
                      ),
                      IconButton(
                        tooltip: copy.send,
                        color: AppColors.primary,
                        icon: const Icon(Icons.send),
                        onPressed: state.sending || _transcribing || _recording
                            ? null
                            : () => _send(),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Suggestions extends StatelessWidget {
  const _Suggestions({required this.bangla, required this.onPick});

  final bool bangla;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final copy = AskCopy(bangla);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Icon(Icons.auto_awesome, size: 36, color: AppColors.primary),
        const SizedBox(height: 12),
        Text(
          bangla
              ? 'আপনার ব্যবসা নিয়ে যেকোনো প্রশ্ন করুন'
              : 'Ask anything about your business',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        Text(
          copy.emptyBody,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 16),
        for (final question in _suggestions[bangla]!)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, kTouchTarget),
                alignment: Alignment.centerLeft,
              ),
              onPressed: () => onPick(question),
              child: Text(question),
            ),
          ),
      ],
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.bangla});

  final AskMessage message;
  final bool bangla;

  @override
  Widget build(BuildContext context) {
    final mine = message.fromMe;
    final copy = AskCopy(bangla);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.85,
        ),
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: mine ? AppColors.primaryTint : AppColors.surface,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(AppRadius.card),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SelectableText(
                message.text.isEmpty ? '—' : message.text,
                style: const TextStyle(fontSize: 14),
              ),
              if (!mine && (message.credits != null || message.truncated)) ...[
                const SizedBox(height: 6),
                Text(
                  [
                    if (message.truncated) copy.truncated,
                    if (message.credits != null)
                      copy.creditsLine(message.credits!),
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textHint,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Thinking extends StatelessWidget {
  const _Thinking({required this.bangla});

  final bool bangla;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerLeft,
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text(
            AskCopy(bangla).thinking,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    ),
  );
}
