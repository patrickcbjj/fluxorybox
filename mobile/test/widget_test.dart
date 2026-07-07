import 'package:flutter_test/flutter_test.dart';
import 'package:fluxorybox/main.dart';

void main() {
  testWidgets('App inicia na tela de configuração', (WidgetTester tester) async {
    await tester.pumpWidget(const FluxoryBoxApp());
    expect(find.text('📬 FluxoryBox — Configuração'), findsOneWidget);
  });
}
