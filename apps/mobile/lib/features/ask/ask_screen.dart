import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/access.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/voice/speech_input.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'ask_data.dart';

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
class AskScreen extends ConsumerStatefulWidget {
  const AskScreen({super.key});

  @override
  ConsumerState<AskScreen> createState() => _AskScreenState();
}

class _AskScreenState extends ConsumerState<AskScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  bool _listening = false;

  @override
  void dispose() {
    if (_listening) ref.read(speechInputProvider).stop();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? text]) async {
    final question = (text ?? _input.text).trim();
    if (question.isEmpty) return;
    if (_listening) await _toggleListening();
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
      showToast(
        'This phone cannot listen right now. Check the microphone '
        'permission, or type the question.',
      );
      return;
    }
    setState(() => _listening = true);
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ask ERP71'),
        actions: [
          TextButton(
            onPressed: () => controller.setBangla(!state.bangla),
            child: Text(state.bangla ? 'English' : 'বাংলা'),
          ),
          if (state.messages.isNotEmpty)
            IconButton(
              tooltip: 'New conversation',
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
                      for (final message in state.messages)
                        _Bubble(message: message),
                      if (state.sending) const _Thinking(),
                    ],
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
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
                        hintText: _listening
                            ? 'Listening…'
                            : state.bangla
                            ? 'আপনার প্রশ্ন লিখুন'
                            : 'Ask about sales, stock, dues…',
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _listening ? 'Stop listening' : 'Speak',
                    color: _listening ? AppColors.danger : AppColors.primary,
                    icon: Icon(_listening ? Icons.stop_circle : Icons.mic_none),
                    onPressed: state.sending ? null : _toggleListening,
                  ),
                  IconButton(
                    tooltip: 'Send',
                    color: AppColors.primary,
                    icon: const Icon(Icons.send),
                    onPressed: state.sending ? null : () => _send(),
                  ),
                ],
              ),
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
        const Text(
          'Answers come from your own records, and only what your role can '
          'see. Each answer uses AI credits.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
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
  const _Bubble({required this.message});

  final AskMessage message;

  @override
  Widget build(BuildContext context) {
    final mine = message.fromMe;
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
                    if (message.truncated) 'Answer cut short',
                    if (message.credits != null)
                      '${message.credits} ${message.credits == 1 ? 'credit' : 'credits'}',
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
  const _Thinking();

  @override
  Widget build(BuildContext context) => const Align(
    alignment: Alignment.centerLeft,
    child: Padding(
      padding: EdgeInsets.all(12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 8),
          Text(
            'Looking through your records…',
            style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
        ],
      ),
    ),
  );
}
