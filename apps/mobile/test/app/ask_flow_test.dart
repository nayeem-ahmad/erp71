import 'dart:convert';

import 'package:erp71_mobile/core/voice/voice_recorder.dart';
import 'package:erp71_mobile/ui/widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

/// A CRM workspace whose plan includes the assistant.
FakeBackend aiBackend({Handler? chat}) => crmBackend()
  ..on(
    'POST',
    '/auth/google',
    (_) => authResponse(tenants: [workspaceJson(premiumAi: true)]),
  )
  ..on(
    'POST',
    '/ai/chat',
    chat ??
        (request) {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return {
            'conversation_id': 'conv-1',
            'credits_used': 2,
            'truncated': false,
            'message': {
              'id': 'm-${body['message']}',
              'role': 'assistant',
              'content': 'Net sales today are ৳ 6,000.00, up 50% on yesterday.',
            },
          };
        },
  )
  ..on(
    'GET',
    '/ai/chat/tools',
    (_) => {
      'tools': ['sales_summary', 'propose_create_task', 'propose_create_lead'],
    },
  );

Future<void> openAsk(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Ask ERP71'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a suggested question is answered, and the thread continues', (
    tester,
  ) async {
    final backend = aiBackend();
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.tap(find.text('How are sales today compared with yesterday?'));
    await tester.pumpAndSettle();

    expect(
      find.text('Net sales today are ৳ 6,000.00, up 50% on yesterday.'),
      findsOneWidget,
    );
    expect(find.text('2 credits'), findsOneWidget);
    expect(backend.lastBody('POST', '/ai/chat'), {
      'message': 'How are sales today compared with yesterday?',
      'locale': 'en',
    });

    await tester.enterText(find.byType(TextField), 'And last week?');
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();
    // Same conversation, so the assistant keeps the context.
    expect(backend.lastBody('POST', '/ai/chat')['conversationId'], 'conv-1');
  });

  testWidgets('spoken words fill the box and wait to be sent', (tester) async {
    final speech = FakeSpeechInput();
    final backend = aiBackend();
    await pumpApp(tester, backend: backend, speech: speech);
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.tap(find.byTooltip('Speak'));
    await tester.pumpAndSettle();
    expect(find.text('Better Bangla'), findsNothing);
    expect(speech.lastLocale, 'en_US');
    speech.say('who owes me');
    await tester.pump();
    speech.say('who owes me the most', isFinal: true);
    speech.finish();
    await tester.pumpAndSettle();

    final box = tester.widget<TextField>(find.byType(TextField));
    expect(box.controller!.text, 'who owes me the most');
    // Heard is not sent.
    expect(backend.sent('POST', '/ai/chat'), isEmpty);

    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();
    expect(
      backend.lastBody('POST', '/ai/chat')['message'],
      'who owes me the most',
    );
  });

  testWidgets('Bangla asks and listens in Bangla', (tester) async {
    final speech = FakeSpeechInput();
    final backend = aiBackend();
    await pumpApp(tester, backend: backend, speech: speech);
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.text('আপনার ব্যবসা নিয়ে যেকোনো প্রশ্ন করুন'), findsOneWidget);

    await tester.tap(find.byTooltip('বলুন'));
    await tester.pumpAndSettle();
    expect(speech.lastLocale, 'bn_BD');
    speech.finish();
    await tester.pumpAndSettle();

    await tester.tap(find.text('কোন পণ্যের স্টক কমে গেছে?'));
    await tester.pumpAndSettle();
    expect(backend.lastBody('POST', '/ai/chat')['locale'], 'bn');
  });

  testWidgets('a refusal is said, and the question is kept to retry', (
    tester,
  ) async {
    final backend = aiBackend(
      chat: (_) => apiError(403, 'This month’s AI credits are used up.'),
    );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.enterText(find.byType(TextField), 'What is running low?');
    await tester.tap(find.byTooltip('Send'));
    await tester.pumpAndSettle();

    expect(find.text('This month’s AI credits are used up.'), findsOneWidget);
    final box = tester.widget<TextField>(find.byType(TextField));
    expect(box.controller!.text, 'What is running low?');
  });

  testWidgets('a phone that cannot listen says so', (tester) async {
    await pumpApp(
      tester,
      backend: aiBackend(),
      speech: FakeSpeechInput(available: false),
    );
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.tap(find.byTooltip('Speak'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('This phone cannot listen right now'),
      findsOneWidget,
    );
  });

  testWidgets('a plan without AI shows no assistant', (tester) async {
    await pumpApp(tester, backend: crmBackend());
    await signInWithGoogle(tester);
    expect(find.byTooltip('Ask ERP71'), findsNothing);
  });

  testWidgets('a task card stays unsaved until a project is chosen', (
    tester,
  ) async {
    final backend = draftBackend(
      draft: _taskDraft,
      tool: 'propose_create_task',
    );
    backend.on('POST', '/project-tasks', (_) => {'id': 'task-1'});
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);
    await _ask(tester, 'Create a task to call the supplier');

    expect(find.text('New task'), findsOneWidget);
    expect(find.text('Call the supplier'), findsOneWidget);
    expect(find.text('About the rice order'), findsOneWidget);
    expect(find.text('Unassigned'), findsOneWidget);
    expect(find.text('Medium'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Cancel'))
          .onPressed,
      isNotNull,
    );

    await tester.ensureVisible(find.text('Choose a project'));
    await tester.tap(find.text('Choose a project'), warnIfMissed: false);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Showroom (SH)').last);
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
          .onPressed,
      isNotNull,
    );

    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Save'));
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(backend.lastBody('POST', '/project-tasks'), {
      'projectId': 'p-show',
      'title': 'Call the supplier',
      'description': 'About the rice order',
      'priority': 'MEDIUM',
    });
    expect(backend.sent('POST', '/crm/leads'), isEmpty);
    expect(find.text('Task saved.'), findsOneWidget);
  });

  testWidgets('a lead card saves the note and does not name an owner', (
    tester,
  ) async {
    final backend = draftBackend(
      draft: _leadDraft,
      tool: 'propose_create_lead',
    );
    backend.on('POST', '/crm/leads', (_) => {'id': 'lead-9', 'name': 'Rahim'});
    backend.on(
      'GET',
      '/crm/leads/lead-9',
      (_) => leadJson(id: 'lead-9', name: 'Rahim'),
    );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);
    await _ask(tester, 'Create a lead for Rahim');

    expect(find.text('New lead'), findsOneWidget);
    expect(find.text('Rahim'), findsWidgets);
    expect(find.textContaining('Karim Traders'), findsOneWidget);
    expect(find.textContaining('You', findRichText: true), findsOneWidget);
    expect(find.textContaining('does not create a company'), findsOneWidget);

    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Save'));
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    final body = backend.lastBody('POST', '/crm/leads');
    expect(body['name'], 'Rahim');
    expect(body['mobile'], '01711111111');
    expect(body['remarks'], contains('Karim Traders'));
    expect(body.containsKey('assigned_to'), isFalse);
    expect(backend.sent('POST', '/project-tasks'), isEmpty);
    expect(find.text('Lead saved.'), findsOneWidget);

    await tester.tap(find.text('Open lead'));
    await tester.pumpAndSettle();
    expect(find.text('Rahim'), findsWidgets);
  });

  testWidgets('cancel discards a draft and does not save it', (tester) async {
    final backend = draftBackend(
      draft: _taskDraft,
      tool: 'propose_create_task',
    );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);
    await _ask(tester, 'Create a task');

    await tester.ensureVisible(find.widgetWithText(OutlinedButton, 'Cancel'));
    await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('New task'), findsNothing);
    expect(find.text('Review the card and press Save.'), findsOneWidget);
    expect(backend.sent('POST', '/project-tasks'), isEmpty);
  });

  testWidgets('a draft is hidden when the tool is not offered', (tester) async {
    final backend = draftBackend(
      draft: _taskDraft,
      tool: 'propose_create_task',
      tools: const ['sales_summary'],
    );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);
    await _ask(tester, 'Create a task');

    expect(find.text('Review the card and press Save.'), findsOneWidget);
    expect(find.text('New task'), findsNothing);
    expect(backend.sent('POST', '/project-tasks'), isEmpty);
  });

  testWidgets('a refused save stays on the card', (tester) async {
    final backend = draftBackend(
      draft: _leadDraft,
      tool: 'propose_create_lead',
    );
    backend.on(
      'POST',
      '/crm/leads',
      (_) => apiError(403, 'You cannot create leads.'),
    );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openAsk(tester);
    await _ask(tester, 'Create a lead');

    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Save'));
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(find.text('You cannot create leads.'), findsOneWidget);
    expect(find.text('New lead'), findsOneWidget);
    expect(find.text('Rahim'), findsWidgets);
  });

  testWidgets('offline keeps the draft editable and disables save', (
    tester,
  ) async {
    final online = FakeOnlineStatus();
    final backend = draftBackend(
      draft: _taskDraft,
      tool: 'propose_create_task',
    );
    await pumpApp(tester, backend: backend, online: online);
    await signInWithGoogle(tester);
    await openAsk(tester);
    await _ask(tester, 'Create a task');

    await tester.ensureVisible(find.text('Choose a project'));
    await tester.tap(find.text('Choose a project'), warnIfMissed: false);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Showroom (SH)').last);
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
          .onPressed,
      isNotNull,
    );

    online.setOnline(false);
    await tester.pumpAndSettle();

    expect(find.textContaining("You're offline"), findsOneWidget);
    expect(find.text('Call the supplier'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
          .onPressed,
      isNull,
    );
    await tester.enterText(find.byType(TextField).first, 'Call tomorrow');
    await tester.pump();
    expect(find.text('Call tomorrow'), findsOneWidget);
    expect(backend.sent('POST', '/project-tasks'), isEmpty);

    // Cancel still works while offline. Invoke it directly: the button can sit
    // under the composer once the card has been scrolled.
    tester
        .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Cancel'))
        .onPressed
        ?.call();
    await tester.pump();
    expect(find.text('New task'), findsNothing);
  });

  testWidgets('Better Bangla is opt-in and fills the box without sending', (
    tester,
  ) async {
    final speech = FakeSpeechInput();
    final recorder = FakeVoiceRecorder(
      clip: const RecordedAudio(base64: 'aaa', format: 'm4a'),
    );
    final backend = aiBackend();
    backend.on(
      'POST',
      '/ai/transcribe',
      (_) => {'transcript': 'আজকের বিক্রি কেমন', 'credits_used': 0.25},
    );
    await pumpApp(tester, backend: backend, speech: speech, recorder: recorder);
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    expect(find.textContaining('০.০৫'), findsOneWidget);

    await tester.tap(find.byTooltip('বলুন'));
    await tester.pumpAndSettle();
    expect(speech.lastLocale, 'bn_BD');
    expect(recorder.starts, 0);
    speech.finish();
    await tester.pumpAndSettle();
    expect(backend.sent('POST', '/ai/transcribe'), isEmpty);

    await tester.tap(find.text('ভালো বাংলা'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('বলুন'));
    await tester.pumpAndSettle();
    expect(recorder.starts, 1);
    expect(recorder.recording, isTrue);
    expect(speech.listening, isFalse);

    await tester.tap(find.byTooltip('রেকর্ড বন্ধ'));
    await tester.pumpAndSettle();

    expect(backend.lastBody('POST', '/ai/transcribe'), {
      'audioBase64': 'aaa',
      'audioFormat': 'm4a',
      'locale': 'bn',
    });
    expect(backend.sent('POST', '/ai/chat'), isEmpty);
    expect(find.textContaining('0.25'), findsOneWidget);
    final box = tester.widget<TextField>(find.byType(TextField).last);
    expect(box.controller!.text, 'আজকের বিক্রি কেমন');

    // The credit note is a snackbar over the send button.
    rootMessengerKey.currentState?.hideCurrentSnackBar();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.byTooltip('পাঠান'));
    await tester.pumpAndSettle();
    expect(
      backend.lastBody('POST', '/ai/chat')['message'],
      'আজকের বিক্রি কেমন',
    );
    expect(backend.lastBody('POST', '/ai/chat')['locale'], 'bn');
  });

  testWidgets('Better Bangla does not record while offline', (tester) async {
    final recorder = FakeVoiceRecorder();
    final backend = aiBackend();
    await pumpApp(
      tester,
      backend: backend,
      recorder: recorder,
      online: FakeOnlineStatus(online: false),
    );
    await signInWithGoogle(tester);
    await openAsk(tester);

    await tester.tap(find.text('বাংলা'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ভালো বাংলা'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('বলুন'));
    await tester.pumpAndSettle();

    expect(recorder.starts, 0);
    expect(backend.sent('POST', '/ai/transcribe'), isEmpty);
    expect(find.textContaining('ইন্টারনেট লাগে'), findsOneWidget);
  });
}

const _taskDraft = {
  'kind': 'task',
  'status': 'needs_input',
  'missing': ['project'],
  'warnings': <String>[],
  'fields': {
    'title': 'Call the supplier',
    'description': 'About the rice order',
    'projectChoices': [
      {'id': 'p-show', 'label': 'Showroom', 'detail': 'SH'},
      {'id': 'p-shop', 'label': 'Shop', 'detail': 'S'},
    ],
    'priority': 'MEDIUM',
  },
};

const _leadDraft = {
  'kind': 'lead',
  'status': 'ready',
  'missing': <String>[],
  'warnings': [
    'The company name is in the note. No company record was created.',
  ],
  'fields': {
    'name': 'Rahim',
    'mobile': '01711111111',
    'remarks': 'Company: Karim Traders\nAsked about rice',
  },
};

FakeBackend draftBackend({
  required Map<String, Object?> draft,
  required String tool,
  List<String>? tools,
}) {
  final backend = aiBackend(
    chat: (_) => {
      'conversation_id': 'conv-1',
      'credits_used': 2,
      'truncated': false,
      'message': {
        'id': 'm-draft',
        'role': 'assistant',
        'content': 'Review the card and press Save.',
        'tool_calls': [
          {'name': tool, 'args': <String, Object?>{}, 'draft': draft},
        ],
      },
    },
  );
  if (tools != null) {
    backend.on('GET', '/ai/chat/tools', (_) => {'tools': tools});
  }
  return backend;
}

Future<void> _ask(WidgetTester tester, String question) async {
  await tester.enterText(find.byType(TextField), question);
  await tester.tap(find.byTooltip('Send'));
  await tester.pumpAndSettle();
}
