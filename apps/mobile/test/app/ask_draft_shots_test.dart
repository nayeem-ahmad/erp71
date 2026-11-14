import 'dart:io';
import 'dart:ui' as ui;

import 'package:erp71_mobile/features/ask/ask_draft.dart';
import 'package:erp71_mobile/features/ask/ask_draft_card.dart';
import 'package:erp71_mobile/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Renders the confirmation cards and, when the artifacts folder is there,
/// writes a PNG of each. The assertions run either way.
Future<void> _loadFonts() async {
  Future<ByteData> bytes(String path) async =>
      ByteData.sublistView(await File(path).readAsBytes());
  const root = '/usr/share/fonts/truetype/noto';
  final sans = FontLoader('NotoSans')
    ..addFont(bytes('$root/NotoSans-Regular.ttf'))
    ..addFont(bytes('$root/NotoSans-Bold.ttf'));
  final bangla = FontLoader('NotoSansBengali')
    ..addFont(bytes('$root/NotoSansBengali-Regular.ttf'))
    ..addFont(bytes('$root/NotoSansBengali-Bold.ttf'));
  await Future.wait([sans.load(), bangla.load()]);
}

const _shotFont = TextStyle(
  fontFamily: 'NotoSans',
  fontFamilyFallback: ['NotoSansBengali'],
  fontSize: 14,
  fontWeight: FontWeight.w600,
);

ThemeData _shotTheme() {
  final base = buildAppTheme();
  final text = base.textTheme.apply(
    fontFamily: 'NotoSans',
    fontFamilyFallback: const ['NotoSansBengali'],
  );
  return base.copyWith(
    textTheme: text,
    primaryTextTheme: base.primaryTextTheme.apply(
      fontFamily: 'NotoSans',
      fontFamilyFallback: const ['NotoSansBengali'],
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: base.filledButtonTheme.style?.copyWith(
        textStyle: const WidgetStatePropertyAll(_shotFont),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: base.outlinedButtonTheme.style?.copyWith(
        textStyle: const WidgetStatePropertyAll(
          TextStyle(
            fontFamily: 'NotoSans',
            fontFamilyFallback: ['NotoSansBengali'],
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppColors.text,
          ),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('task and lead cards in English and Bangla', (tester) async {
    await tester.runAsync(_loadFonts);
    debugDisableClipLayers = true;
    debugDisablePhysicalShapeLayers = true;
    debugDisableOpacityLayers = true;
    addTearDown(() {
      debugDisableClipLayers = false;
      debugDisablePhysicalShapeLayers = false;
      debugDisableOpacityLayers = false;
    });
    try {
      await _shot(
        tester,
        name: 'ask-task-card-en',
        bangla: false,
        reply: 'Review the card and press Save. Nothing is saved until you do.',
        draft: _task(bangla: false),
      );
      await _shot(
        tester,
        name: 'ask-task-card-bn',
        bangla: true,
        reply:
            'কার্ডটি দেখে সেভ চাপুন। আপনি সেভ না করা পর্যন্ত কিছু সেভ হয় না।',
        draft: _task(bangla: true),
      );
      await _shot(
        tester,
        name: 'ask-lead-card-en',
        bangla: false,
        reply: 'Review the card and press Save. Nothing is saved until you do.',
        draft: _lead(bangla: false),
      );
      await _shot(
        tester,
        name: 'ask-lead-card-bn',
        bangla: true,
        reply:
            'কার্ডটি দেখে সেভ চাপুন। আপনি সেভ না করা পর্যন্ত কিছু সেভ হয় না।',
        draft: _lead(bangla: true),
      );
    } finally {
      debugDisableClipLayers = false;
      debugDisablePhysicalShapeLayers = false;
      debugDisableOpacityLayers = false;
    }
  });
}

AskDraft _task({required bool bangla}) => AskDraft(
  kind: AskDraftKind.task,
  status: 'ready',
  fields: AskDraftFields(
    title: bangla ? 'সরবরাহকারীকে ফোন করা' : 'Call the supplier',
    description: bangla ? 'চালের অর্ডার নিয়ে' : 'About the rice order',
    projectId: 'p-show',
    projectName: bangla ? 'শোরুম' : 'Showroom',
    projectChoices: [
      AskChoice(
        id: 'p-show',
        label: bangla ? 'শোরুম' : 'Showroom',
        detail: 'SH',
      ),
    ],
    dueDate: '2026-11-15',
    priority: 'MEDIUM',
  ),
);

AskDraft _lead({required bool bangla}) => AskDraft(
  kind: AskDraftKind.lead,
  fields: AskDraftFields(
    name: bangla ? 'রহিম' : 'Rahim',
    mobile: '01711111111',
    remarks: bangla
        ? 'কোম্পানি: করিম ট্রেডার্স\nচালের কথা জিজ্ঞাসা করেছেন'
        : 'Company: Karim Traders\nAsked about rice',
  ),
);

/// Flatten every picture the card painted. Keeping only the last layer drops
/// the white card and the fields above it.
ui.Picture _flatten(ContainerLayer root, Size size) {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(Offset.zero & size, Paint()..color = AppColors.canvas);

  void walk(Layer? layer, Offset origin) {
    while (layer != null) {
      var next = origin;
      if (layer is OffsetLayer) next = origin + layer.offset;
      if (layer is PictureLayer && layer.picture != null) {
        canvas
          ..save()
          ..translate(next.dx, next.dy)
          ..drawPicture(layer.picture!)
          ..restore();
      }
      if (layer is ContainerLayer) walk(layer.firstChild, next);
      layer = layer.nextSibling;
    }
  }

  walk(root.firstChild, Offset.zero);
  return recorder.endRecording();
}

Future<void> _shot(
  WidgetTester tester, {
  required String name,
  required bool bangla,
  required String reply,
  required AskDraft draft,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(400, 1400);
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      theme: _shotTheme(),
      home: Scaffold(
        body: Align(
          alignment: Alignment.topCenter,
          child: RepaintBoundary(
            key: const ValueKey('shot'),
            child: SizedBox(
              width: 360,
              child: ColoredBox(
                color: AppColors.canvas,
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          border: Border.all(color: AppColors.border),
                          borderRadius: BorderRadius.circular(AppRadius.card),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(
                            reply,
                            style: const TextStyle(fontSize: 14),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      AskDraftCard(
                        // A new draft must not reuse the previous card's fields.
                        key: ValueKey(name),
                        draft: draft,
                        bangla: bangla,
                        online: true,
                        onSave: (_) async => null,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));

  expect(find.text(bangla ? 'সেভ' : 'Save'), findsOneWidget);
  expect(find.text(bangla ? 'বাতিল' : 'Cancel'), findsOneWidget);
  if (draft.kind == AskDraftKind.task) {
    expect(find.text(bangla ? 'নতুন টাস্ক' : 'New task'), findsOneWidget);
    expect(find.text(bangla ? 'মাঝারি' : 'Medium'), findsOneWidget);
  } else {
    expect(find.text(bangla ? 'নতুন লিড' : 'New lead'), findsOneWidget);
    expect(
      find.textContaining(bangla ? 'মালিক' : 'Owner', findRichText: true),
      findsOneWidget,
    );
  }

  final dir = Directory('/opt/cursor/artifacts');
  if (!dir.existsSync()) return;
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('shot')),
  );
  expect(boundary.debugNeedsPaint, isFalse, reason: 'size ${boundary.size}');
  // The view's scene.toImage never completes in this tester. Paint the card
  // into its own picture and rasterize that outside the test zone.
  final bytes = await tester.runAsync(() async {
    final size = boundary.size;
    final container = OffsetLayer();
    final context = PaintingContext(container, Offset.zero & size);
    boundary.paint(context, Offset.zero);
    // The picture is only attached once recording stops, and that method is
    // protected because it is meant for the framework's own paint pass.
    // ignore: invalid_use_of_protected_member
    context.stopRecordingIfNeeded();
    final picture = _flatten(container, size);
    final image = picture.toImageSync(size.width.ceil(), size.height.ceil());
    picture.dispose();
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    final copied = data == null
        ? null
        : Uint8List.fromList(data.buffer.asUint8List());
    if (copied != null && copied.isNotEmpty) {
      await File('${dir.path}/$name.png').writeAsBytes(copied);
    }
    return copied;
  });
  if (bytes == null || bytes.isEmpty) {
    throw StateError('No screenshot for $name');
  }
}
