import 'dart:convert';

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

    await tester.tap(find.byTooltip('Speak'));
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
}
