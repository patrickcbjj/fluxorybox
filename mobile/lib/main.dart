import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_widget_from_html_core/flutter_widget_from_html_core.dart';
import 'package:file_picker/file_picker.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api.dart';
import 'updater.dart';
import 'notifications.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.load();
  try { await Notifications.init(); } catch (_) {/* segue sem push se o Firebase falhar */}
  runApp(const FluxoryBoxApp());
}

const accent = Color(0xFF6D7CFF);
const bg = Color(0xFF0D0F14);
const surface = Color(0xFF14171E);
const surface2 = Color(0xFF1B1F28);
const line = Color(0xFF262B36);
const muted = Color(0xFF7D8598);

// Rótulos de pastas por special-use (espelha a web).
const folderLabels = {
  '\\Inbox': 'Caixa de entrada',
  '\\Sent': 'Enviados',
  '\\Drafts': 'Rascunhos',
  '\\Junk': 'Spam',
  '\\Trash': 'Lixeira',
  '\\Archive': 'Arquivo',
  '\\All': 'Todos os emails',
  '\\Flagged': 'Favoritos',
};

// Cor estável a partir de uma string (mesma fórmula da web).
Color accColor(String? s) {
  final str = s ?? '';
  int h = 0;
  for (final c in str.codeUnits) {
    h = (h * 31 + c) % 360;
  }
  return HSLColor.fromAHSL(1, h.toDouble(), 0.55, 0.55).toColor();
}

String initials(String? name, String? email) {
  final base = (name != null && name.trim().isNotEmpty) ? name : (email ?? '?');
  final parts = base.replaceAll(RegExp(r'[<>]'), '').trim().split(RegExp(r'[\s@.]+'))
      .where((e) => e.isNotEmpty).toList();
  final a = parts.isNotEmpty && parts[0].isNotEmpty ? parts[0][0] : '';
  final b = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
  final r = (a + b).toUpperCase();
  return r.isNotEmpty ? r : (base.isNotEmpty ? base[0].toUpperCase() : '?');
}

String fmtDate(dynamic d) {
  if (d == null) return '';
  final date = DateTime.tryParse(d.toString())?.toLocal();
  if (date == null) return '';
  final now = DateTime.now();
  if (date.year == now.year && date.month == now.month && date.day == now.day) {
    return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  if (date.year == now.year) return '${date.day} ${meses[date.month - 1]}';
  return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year.toString().substring(2)}';
}

class FluxoryBoxApp extends StatelessWidget {
  const FluxoryBoxApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FluxoryBox',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.dark),
        scaffoldBackgroundColor: bg,
        dialogTheme: const DialogThemeData(backgroundColor: surface),
      ),
      home: Api.configured ? const InboxScreen() : const SettingsScreen(),
    );
  }
}

// ---------------- Avatares ----------------
class AccountAvatar extends StatelessWidget {
  final Map account;
  final double size;
  const AccountAvatar({super.key, required this.account, this.size = 40});
  @override
  Widget build(BuildContext context) {
    final url = account['avatarUrl']?.toString() ?? '';
    final email = account['email']?.toString() ?? '';
    final fallback = _initialsCircle(initials(account['displayName']?.toString(), email), accColor(email), size);
    if (url.isEmpty) return fallback;

    // Microsoft/Hotmail vem como data URL (data:image/...;base64,...) — NetworkImage não
    // renderiza data:, então decodifico e uso Image.memory. Google vem como URL http normal.
    if (url.startsWith('data:')) {
      try {
        final bytes = base64Decode(url.substring(url.indexOf(',') + 1));
        return ClipOval(child: Image.memory(bytes, width: size, height: size, fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => fallback));
      } catch (_) {
        return fallback;
      }
    }
    return ClipOval(child: Image.network(url, width: size, height: size, fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallback,
        loadingBuilder: (ctx, child, prog) => prog == null ? child : fallback));
  }
}

Widget _initialsCircle(String text, Color color, double size) {
  return CircleAvatar(
    radius: size / 2,
    backgroundColor: color,
    child: Text(text, style: TextStyle(fontSize: size * 0.36, fontWeight: FontWeight.w600, color: Colors.white)),
  );
}

class SenderAvatar extends StatelessWidget {
  final String? name;
  final String? address;
  final double size;
  const SenderAvatar({super.key, this.name, this.address, this.size = 42});
  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: accColor(address ?? name),
      child: Text(initials(name, address),
          style: TextStyle(fontSize: size * 0.36, fontWeight: FontWeight.w600, color: Colors.white)),
    );
  }
}

// ---------------- Settings / Login ----------------
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _url = TextEditingController(
      text: Api.baseUrl.isNotEmpty ? Api.baseUrl : 'https://fluxorybox.discloud.app');
  final _user = TextEditingController();
  final _pass = TextEditingController();
  String? _msg;
  bool _saving = false;

  Future<void> _login() async {
    setState(() { _saving = true; _msg = null; });
    try {
      await Api.login(_url.text, _user.text.trim(), _pass.text);
      if (mounted) {
        Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const InboxScreen()));
      }
    } catch (e) {
      setState(() { _msg = e.toString(); _saving = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 64, height: 64,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                gradient: const LinearGradient(colors: [Color(0xFF7C8BFF), Color(0xFF8B6BFF)]),
              ),
              child: const Icon(Icons.mail_outline_rounded, color: Colors.white, size: 32),
            ),
            const SizedBox(height: 16),
            const Text('FluxoryBox',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: -0.5)),
            const SizedBox(height: 4),
            const Text('Entre com seu usuário e senha', style: TextStyle(color: muted)),
            const SizedBox(height: 28),
            TextField(controller: _url, decoration: _dec('Servidor')),
            const SizedBox(height: 14),
            TextField(controller: _user, autofillHints: const [AutofillHints.username], decoration: _dec('Usuário')),
            const SizedBox(height: 14),
            TextField(controller: _pass, obscureText: true, onSubmitted: (_) => _login(), decoration: _dec('Senha')),
            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _saving ? null : _login,
                style: FilledButton.styleFrom(backgroundColor: accent, padding: const EdgeInsets.symmetric(vertical: 14)),
                child: Text(_saving ? 'Entrando...' : 'Entrar'),
              ),
            ),
            if (_msg != null)
              Padding(padding: const EdgeInsets.only(top: 16),
                  child: Text(_msg!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent))),
          ]),
        ),
      ),
    );
  }

  InputDecoration _dec(String label) =>
      InputDecoration(labelText: label, border: const OutlineInputBorder());
}

// ---------------- Inbox ----------------
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});
  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> with WidgetsBindingObserver {
  static const int page = 25;
  List _accounts = [];
  List _messages = [];
  List _folders = [];
  dynamic _view = 'unified'; // 'unified' | accountId(int)
  String _folder = 'INBOX';
  int _offset = 0;
  int _unifiedLimit = 40;
  bool _loading = true;
  bool _loadingMore = false;
  bool _refreshing = false;
  String? _error;
  bool _needsReconnect = false;

  // Busca
  bool _searchOpen = false;
  bool _searching = false;
  String _query = '';
  final _searchCtrl = TextEditingController();

  Timer? _poll;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _boot();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _refreshSilent());
    // Checa atualização do app e pede permissão de notificação após montar a tela.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Updater.check(context);
      Notifications.requestAndRegister();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshSilent();
  }

  Future<void> _boot() async {
    try {
      _accounts = await Api.accounts();
    } catch (_) {}
    await _load(reset: true);
  }

  Map? get _account => _view is int
      ? _accounts.cast<Map>().firstWhere((a) => a['id'] == _view, orElse: () => {})
      : null;

  String get _contextTitle {
    if (_view == 'unified') return 'Todas as contas';
    final a = _account;
    if (a == null || a.isEmpty) return '';
    return (a['displayName']?.toString().isNotEmpty == true ? a['displayName'] : a['email']).toString();
  }

  String get _folderLabel {
    final f = _folders.cast<Map>().firstWhere((x) => x['path'] == _folder, orElse: () => {});
    if (f.isNotEmpty) {
      return folderLabels[f['specialUse']] ??
          (f['path'] == 'INBOX' ? 'Caixa de entrada' : (f['name'] ?? _folder).toString());
    }
    return 'Caixa de entrada';
  }

  Future<void> _selectView(dynamic v) async {
    setState(() {
      _view = v; _folder = 'INBOX'; _offset = 0; _unifiedLimit = 40; _folders = [];
      _searching = false; _searchOpen = false; _query = ''; _searchCtrl.clear();
    });
    await _load(reset: true);
    if (v is int) {
      try {
        final f = await Api.folders(v);
        if (mounted) setState(() => _folders = f);
      } catch (_) {}
    }
  }

  Future<void> _load({bool reset = true}) async {
    if (reset) setState(() { _loading = true; _error = null; _needsReconnect = false; _offset = 0; });
    try {
      if (_view == 'unified') {
        final data = await Api.inbox(limit: _unifiedLimit);
        _messages = data['messages'] ?? [];
      } else {
        final data = await Api.accountMessages(_view as int, folder: _folder, limit: page, offset: _offset);
        final list = (data['messages'] ?? []) as List;
        _messages = (reset || _offset == 0) ? list : [..._messages, ...list];
      }
    } catch (e) {
      _error = e.toString();
      _needsReconnect = e is ApiException && e.needsReconnect;
    }
    if (mounted) setState(() => _loading = false);
  }

  // Ordem das "abas" pro gesto de arrastar: Todas, depois cada conta.
  List get _viewOrder => ['unified', ..._accounts.cast<Map>().map((a) => a['id'])];
  void _swipeAccount(int dir) {
    if (_searching) return;
    final order = _viewOrder;
    final idx = order.indexWhere((v) => v == _view);
    if (idx < 0) return;
    final next = idx + dir;
    if (next < 0 || next >= order.length) return;
    _selectView(order[next]);
  }

  // Contas atualmente desconectadas (pra avisar e oferecer reconexão).
  List<Map> get _disconnectedAccounts {
    if (_view is int) {
      final a = _account;
      return (a != null && a['disconnected'] == true) ? [a] : [];
    }
    return _accounts.cast<Map>().where((a) => a['disconnected'] == true).toList();
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _reconnect(Map a) async {
    // Conta OAuth: reabre o login Microsoft/Google no navegador.
    if (a['authType'] == 'oauth') {
      final prov = (a['provider'] ?? 'microsoft').toString();
      final ok = await runOAuthFlow(context, prov, reconnectEmail: a['email'].toString());
      if (ok) {
        _snack('Conta reconectada.');
        try { _accounts = await Api.accounts(); } catch (_) {}
        await _load(reset: true);
      }
      return;
    }
    // Conta por senha: reinserir a senha de app.
    final ctrl = TextEditingController();
    final pass = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reconectar conta'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Digite a senha de app novamente para reconectar ${a['email']}.',
              style: const TextStyle(fontSize: 13, color: muted)),
          const SizedBox(height: 12),
          TextField(controller: ctrl, obscureText: true, autofocus: true,
              decoration: const InputDecoration(labelText: 'Senha de app', border: OutlineInputBorder())),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Reconectar')),
        ],
      ),
    );
    if (pass == null || pass.isEmpty) return;
    try {
      await Api.addAccount({'displayName': a['displayName'] ?? '', 'email': a['email'], 'password': pass});
      _snack('Conta reconectada.');
      try { _accounts = await Api.accounts(); } catch (_) {}
      await _load(reset: true);
    } catch (e) {
      _snack('Falha ao reconectar: $e');
    }
  }

  Future<void> _loadMore() async {
    setState(() => _loadingMore = true);
    if (_view == 'unified') { _unifiedLimit += 40; } else { _offset += page; }
    await _load(reset: false);
    if (mounted) setState(() => _loadingMore = false);
  }

  // Refresh silencioso pro polling (não mostra spinner).
  // Atualização suave: mantém os emails na tela; com `visible` mostra só a barra fina no topo.
  Future<void> _refreshSilent({bool visible = false}) async {
    if (_searching || !mounted) return;
    if (visible) setState(() => _refreshing = true);
    // Atualiza o estado de conexão das contas (aviso de desconectada) sem spinner.
    try { _accounts = await Api.accounts(); } catch (_) {}
    try {
      if (_view == 'unified') {
        final data = await Api.inbox(limit: _unifiedLimit);
        _messages = data['messages'] ?? [];
      } else {
        final span = _offset + page;
        final data = await Api.accountMessages(_view as int, folder: _folder, limit: span, offset: 0);
        _messages = data['messages'] ?? [];
      }
    } catch (_) {}
    if (mounted) setState(() => _refreshing = false);
  }

  Future<void> _runSearch() async {
    final q = _searchCtrl.text.trim();
    if (q.isEmpty) { _clearSearch(); return; }
    setState(() { _searching = true; _query = q; _loading = true; _error = null; });
    try {
      final data = _view == 'unified'
          ? await Api.searchUnified(q)
          : await Api.searchAccount(_view as int, _folder, q);
      _messages = data['messages'] ?? [];
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() => _loading = false);
  }

  void _clearSearch() {
    setState(() { _searching = false; _query = ''; _searchCtrl.clear(); _searchOpen = false; });
    _load(reset: true);
  }

  Future<void> _openFolders() async {
    final items = _folders.isNotEmpty ? _folders : [{'path': 'INBOX', 'name': 'INBOX'}];
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.all(16),
              child: Text('Pastas', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
          ...items.cast<Map>().map((f) {
            final label = folderLabels[f['specialUse']] ??
                (f['path'] == 'INBOX' ? 'Caixa de entrada' : (f['name'] ?? f['path']).toString());
            final active = f['path'] == _folder;
            return ListTile(
              leading: Icon(active ? Icons.folder_rounded : Icons.folder_outlined,
                  color: active ? accent : muted),
              title: Text(label, style: TextStyle(color: active ? accent : null)),
              onTap: () => Navigator.pop(context, f['path']?.toString()),
            );
          }),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (chosen != null && chosen != _folder) {
      setState(() { _folder = chosen; _offset = 0; });
      await _load(reset: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        bottom: _refreshing
            ? const PreferredSize(
                preferredSize: Size.fromHeight(2),
                child: SizedBox(height: 2, child: LinearProgressIndicator(minHeight: 2, backgroundColor: Colors.transparent)),
              )
            : null,
        title: _searchOpen
            ? TextField(
                controller: _searchCtrl,
                autofocus: true,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _runSearch(),
                decoration: const InputDecoration(
                    hintText: 'Buscar no servidor...', border: InputBorder.none),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_contextTitle, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                  if (_view != 'unified')
                    GestureDetector(
                      onTap: _openFolders,
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Text(_folderLabel, style: const TextStyle(fontSize: 12, color: muted)),
                        const Icon(Icons.arrow_drop_down, size: 18, color: muted),
                      ]),
                    ),
                ],
              ),
        actions: [
          IconButton(
            icon: Icon(_searchOpen ? Icons.close_rounded : Icons.search_rounded),
            onPressed: () {
              if (_searchOpen) { _clearSearch(); }
              else { setState(() => _searchOpen = true); }
            },
          ),
          if (!_searchOpen) ...[
            IconButton(
              icon: const Icon(Icons.refresh_rounded),
              onPressed: () {
                if (_searching) { _runSearch(); } else { _refreshSilent(visible: true); }
              },
            ),
            IconButton(
              icon: const Icon(Icons.manage_accounts_rounded),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AccountsScreen()))
                  .then((_) async { try { _accounts = await Api.accounts(); } catch (_) {} if (mounted) setState(() {}); }),
            ),
            PopupMenuButton<String>(
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (v) async {
                if (v == 'update') {
                  Updater.check(context, auto: false);
                } else if (v == 'notif') {
                  final ok = await Notifications.requestAndRegister();
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: Text(ok ? 'Notificações ativadas.' : 'Permissão de notificação negada.')));
                  }
                } else if (v == 'logout') {
                  await Notifications.unregister();
                  await Api.logout();
                  if (context.mounted) {
                    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
                  }
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'notif', child: Row(children: [Icon(Icons.notifications_active_rounded, size: 20), SizedBox(width: 10), Text('Ativar notificações')])),
                PopupMenuItem(value: 'update', child: Row(children: [Icon(Icons.system_update_rounded, size: 20), SizedBox(width: 10), Text('Buscar atualizações')])),
                PopupMenuItem(value: 'logout', child: Row(children: [Icon(Icons.logout_rounded, size: 20), SizedBox(width: 10), Text('Sair')])),
              ],
            ),
          ],
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: accent,
        icon: const Icon(Icons.edit_rounded),
        label: const Text('Escrever'),
        onPressed: _accounts.isEmpty ? null : () => _openCompose(),
      ),
      body: Column(children: [
        _accountRail(),
        if (_searching) _searchBanner(),
        ..._disconnectedAccounts.map(_reconnectBanner),
        Expanded(
          // Arrastar pro lado troca a conta em foco (Todas ↔ contas).
          child: GestureDetector(
            onHorizontalDragEnd: (d) {
              final v = d.primaryVelocity ?? 0;
              if (v < -250) {
                _swipeAccount(1);       // arrastou p/ esquerda → próxima conta
              } else if (v > 250) {
                _swipeAccount(-1);      // arrastou p/ direita → conta anterior
              }
            },
            child: _listArea(),
          ),
        ),
      ]),
    );
  }

  Widget _accountRail() {
    return Container(
      height: 84,
      decoration: const BoxDecoration(
        color: surface,
        border: Border(bottom: BorderSide(color: line)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        children: [
          _railItem(
            selected: _view == 'unified',
            onTap: () => _selectView('unified'),
            child: const CircleAvatar(radius: 20, backgroundColor: surface2, child: Icon(Icons.all_inbox_rounded, size: 20, color: accent)),
            label: 'Todas',
          ),
          ..._accounts.cast<Map>().map((a) => _railItem(
                selected: _view == a['id'],
                onTap: () => _selectView(a['id']),
                child: AccountAvatar(account: a, size: 40),
                label: (a['displayName']?.toString().isNotEmpty == true ? a['displayName'] : a['email']).toString(),
                pill: accColor(a['email']?.toString()),
                warn: a['disconnected'] == true,
              )),
          _railItem(
            selected: false,
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AccountsScreen()))
                .then((_) async { try { _accounts = await Api.accounts(); } catch (_) {} if (mounted) setState(() {}); }),
            child: const CircleAvatar(radius: 20, backgroundColor: surface2, child: Icon(Icons.add_rounded, size: 22, color: muted)),
            label: 'Adicionar',
          ),
        ],
      ),
    );
  }

  Widget _railItem({required bool selected, required VoidCallback onTap, required Widget child, required String label, Color? pill, bool warn = false}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 64,
        margin: const EdgeInsets.symmetric(horizontal: 2),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Stack(clipBehavior: Clip.none, children: [
            Container(
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                    color: selected ? (warn ? const Color(0xFFFF6B7A) : (pill ?? accent)) : Colors.transparent,
                    width: 2),
              ),
              child: child,
            ),
            if (warn)
              Positioned(
                top: -2, right: -2,
                child: Container(
                  width: 16, height: 16,
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF6B7A), shape: BoxShape.circle,
                    border: Border.all(color: surface, width: 2),
                  ),
                  child: const Icon(Icons.priority_high_rounded, size: 10, color: Colors.white),
                ),
              ),
          ]),
          const SizedBox(height: 4),
          Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 10.5, color: selected ? Colors.white : muted)),
        ]),
      ),
    );
  }

  Widget _reconnectBanner(Map a) {
    final msg = (a['statusMessage']?.toString().isNotEmpty == true)
        ? a['statusMessage'].toString()
        : 'Reconecte para voltar a receber os emails.';
    final name = (a['displayName']?.toString().isNotEmpty == true ? a['displayName'] : a['email']).toString();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(10, 8, 10, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0x1AFF6B7A),
        border: Border.all(color: const Color(0x52FF6B7A)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(children: [
        const Icon(Icons.warning_amber_rounded, size: 20, color: Color(0xFFFF6B7A)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('$name foi desconectada', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFFFF6B7A))),
          Text(msg, style: const TextStyle(fontSize: 11.5, color: Colors.white70)),
        ])),
        const SizedBox(width: 8),
        FilledButton(
          onPressed: () => _reconnect(a),
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFFF6B7A),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            minimumSize: const Size(0, 0), tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
          child: const Text('Reconectar', style: TextStyle(fontSize: 12.5)),
        ),
      ]),
    );
  }

  Widget _searchBanner() {
    return Container(
      width: double.infinity,
      color: surface2,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      child: Row(children: [
        Expanded(child: Text('Resultados no servidor para "$_query"',
            style: const TextStyle(fontSize: 12.5, color: muted), overflow: TextOverflow.ellipsis)),
        TextButton(onPressed: _clearSearch, child: const Text('Limpar')),
      ]),
    );
  }

  Widget _listArea() {
    if (_loading) return const _SkeletonList();
    if (_error != null) {
      return _ErrorView(
        error: _error!,
        onRetry: () => _load(reset: true),
        onReconnect: (_needsReconnect && _view is int && _account != null && (_account!).isNotEmpty)
            ? () => _reconnect(_account!)
            : null,
      );
    }
    if (_messages.isEmpty) {
      return Center(child: Text(_searching ? 'Nenhum resultado.' : 'Sem mensagens por aqui.',
          style: const TextStyle(color: muted)));
    }
    final showLoadMore = !_searching;
    return RefreshIndicator(
      onRefresh: () => _refreshSilent(),
      child: ListView.separated(
        itemCount: _messages.length + (showLoadMore ? 1 : 0),
        separatorBuilder: (_, __) => const Divider(height: 1, color: line),
        itemBuilder: (_, i) {
          if (i >= _messages.length) {
            return Padding(
              padding: const EdgeInsets.all(12),
              child: Center(
                child: _loadingMore
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : OutlinedButton(onPressed: _loadMore, child: const Text('Carregar mais')),
              ),
            );
          }
          return _MessageTile(
            msg: _messages[i],
            showAccount: _view == 'unified',
            onTap: () => Navigator.push(context, MaterialPageRoute(
                builder: (_) => MessageScreen(summary: _messages[i], accounts: _accounts))).then((_) => _refreshSilent()),
          );
        },
      ),
    );
  }

  void _openCompose({Map? pre}) {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => ComposeScreen(
        accounts: _accounts,
        fixedAccountId: pre?['accountId'] ?? (_view is int ? _view : null),
        to: pre?['to'], cc: pre?['cc'], subject: pre?['subject'], body: pre?['body'],
      ),
    ));
  }
}

class _MessageTile extends StatelessWidget {
  final Map msg;
  final bool showAccount;
  final VoidCallback onTap;
  const _MessageTile({required this.msg, required this.showAccount, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final fromList = (msg['from'] as List?) ?? [];
    final f = fromList.isNotEmpty ? fromList[0] : {};
    final from = (f['name']?.toString().isNotEmpty == true ? f['name'] : f['address']) ?? '(desconhecido)';
    final seen = msg['seen'] == true;
    final flagged = msg['flagged'] == true;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      leading: SenderAvatar(name: f['name']?.toString(), address: f['address']?.toString()),
      title: Row(children: [
        Expanded(child: Text(from.toString(), maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(fontWeight: seen ? FontWeight.w500 : FontWeight.bold))),
        if (flagged) const Padding(padding: EdgeInsets.only(right: 4), child: Icon(Icons.star_rounded, size: 15, color: Color(0xFFF5C518))),
        Text(fmtDate(msg['date']), style: const TextStyle(fontSize: 11, color: muted)),
      ]),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(msg['subject'] ?? '(sem assunto)', maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: seen ? muted : Colors.white70)),
        if (showAccount)
          Row(children: [
            Container(width: 7, height: 7, margin: const EdgeInsets.only(right: 5),
                decoration: BoxDecoration(shape: BoxShape.circle, color: accColor(msg['accountEmail']?.toString()))),
            Expanded(child: Text(msg['accountEmail'] ?? '', maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: muted))),
          ]),
      ]),
      onTap: onTap,
    );
  }
}

// ---------------- Message detail ----------------
class MessageScreen extends StatefulWidget {
  final Map summary;
  final List accounts;
  const MessageScreen({super.key, required this.summary, required this.accounts});
  @override
  State<MessageScreen> createState() => _MessageScreenState();
}

class _MessageScreenState extends State<MessageScreen> {
  Map? _full;
  String? _error;
  bool _flagged = false;
  int? _downloading;

  String get _folder => (widget.summary['folder'] ?? 'INBOX').toString();
  int get _accountId => widget.summary['accountId'];
  int get _uid => widget.summary['uid'];

  @override
  void initState() {
    super.initState();
    _flagged = widget.summary['flagged'] == true;
    _load();
  }

  Future<void> _load() async {
    try {
      _full = await Api.message(_accountId, _uid, _folder);
    } catch (e) {
      _error = e.toString();
    }
    if (mounted) setState(() {});
  }

  Future<void> _toggleStar() async {
    final on = !_flagged;
    setState(() => _flagged = on);
    try {
      await Api.setFlags(_accountId, _uid, _folder,
          add: on ? ['\\Flagged'] : [], remove: on ? [] : ['\\Flagged']);
    } catch (e) {
      if (mounted) { setState(() => _flagged = !on); _snack('Falha: $e'); }
    }
  }

  Future<void> _markUnread() async {
    try {
      await Api.setFlags(_accountId, _uid, _folder, remove: ['\\Seen']);
      if (mounted) { _snack('Marcada como não lida'); Navigator.pop(context); }
    } catch (e) { _snack('Falha: $e'); }
  }

  Future<void> _move(String target, String label) async {
    try {
      await Api.move(_accountId, _uid, _folder, target);
      if (mounted) { _snack('Movido para $label'); Navigator.pop(context); }
    } catch (e) { _snack('Falha: $e'); }
  }

  Future<void> _downloadAttachment(int index, String filename) async {
    setState(() => _downloading = index);
    try {
      final bytes = await Api.attachmentBytes(_accountId, _uid, _folder, index);
      final dir = await getTemporaryDirectory();
      final safe = filename.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_');
      final path = '${dir.path}/$safe';
      await File(path).writeAsBytes(bytes);
      final res = await OpenFilex.open(path);
      if (res.type != ResultType.done && mounted) _snack('Anexo salvo, mas não foi possível abrir (${res.message})');
    } catch (e) {
      _snack('Falha ao baixar: $e');
    }
    if (mounted) setState(() => _downloading = null);
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  // Helpers de resposta/encaminhamento (espelham a web).
  String _reSubject(String? s) => RegExp(r'^re:', caseSensitive: false).hasMatch(s ?? '') ? s! : 'Re: ${s ?? ''}';
  String _fwdSubject(String? s) => RegExp(r'^fwd?:', caseSensitive: false).hasMatch(s ?? '') ? s! : 'Fwd: ${s ?? ''}';

  String _quote(Map full, {bool forward = false}) {
    final fromList = (full['from'] as List?) ?? [];
    final f = fromList.isNotEmpty ? fromList[0] : {};
    final dateStr = full['date'] != null ? DateTime.tryParse(full['date'].toString())?.toLocal().toString() ?? '' : '';
    final text = (full['text'] ?? '').toString();
    if (forward) {
      return '\n\n---------- Mensagem encaminhada ----------\n'
          'De: ${f['name'] ?? ''} <${f['address'] ?? ''}>\nData: $dateStr\nAssunto: ${full['subject'] ?? ''}\n\n$text';
    }
    final quoted = text.split('\n').map((l) => '> $l').join('\n');
    return '\n\nEm $dateStr, ${f['name'] ?? f['address'] ?? ''} escreveu:\n$quoted';
  }

  String _replyAllCc(Map full) {
    final mine = widget.accounts.cast<Map>()
        .firstWhere((a) => a['id'] == _accountId, orElse: () => {})['email']?.toString().toLowerCase();
    final all = <String>[];
    for (final x in [...((full['to'] as List?) ?? []), ...((full['cc'] as List?) ?? [])]) {
      final addr = x['address']?.toString();
      if (addr != null && addr.isNotEmpty && addr.toLowerCase() != mine) all.add(addr);
    }
    return all.toSet().join(', ');
  }

  void _compose({String? to, String? cc, required String subject, required String body}) {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => ComposeScreen(
        accounts: widget.accounts, fixedAccountId: _accountId,
        to: to, cc: cc, subject: subject, body: body,
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final full = _full;
    final fromList = full != null ? (full['from'] as List?) ?? [] : [];
    final f = fromList.isNotEmpty ? fromList[0] : {};
    final attachments = full != null ? (full['attachments'] as List?) ?? [] : [];
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mensagem'),
        actions: [
          IconButton(
            icon: Icon(_flagged ? Icons.star_rounded : Icons.star_outline_rounded,
                color: _flagged ? const Color(0xFFF5C518) : null),
            tooltip: 'Favoritar', onPressed: full == null ? null : _toggleStar),
          IconButton(icon: const Icon(Icons.mark_email_unread_outlined), tooltip: 'Marcar não lida',
              onPressed: full == null ? null : _markUnread),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'archive') _move('Archive', 'Arquivo');
              if (v == 'trash') _move('Trash', 'Lixeira');
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'archive', child: Row(children: [Icon(Icons.archive_outlined, size: 20), SizedBox(width: 10), Text('Arquivar')])),
              PopupMenuItem(value: 'trash', child: Row(children: [Icon(Icons.delete_outline, size: 20), SizedBox(width: 10), Text('Lixeira')])),
            ],
          ),
        ],
      ),
      body: _error != null
          ? _ErrorView(error: _error!, onRetry: _load)
          : full == null
              ? const Center(child: CircularProgressIndicator())
              : Column(children: [
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(full['subject'] ?? '(sem assunto)',
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        Row(children: [
                          SenderAvatar(name: f['name']?.toString(), address: f['address']?.toString()),
                          const SizedBox(width: 10),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(f['name']?.toString().isNotEmpty == true ? f['name'] : (f['address'] ?? ''),
                                style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text('${f['address'] ?? ''} · ${fmtDate(full['date'])}',
                                style: const TextStyle(fontSize: 12, color: muted)),
                          ])),
                        ]),
                        if (attachments.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            for (int i = 0; i < attachments.length; i++)
                              ActionChip(
                                avatar: _downloading == i
                                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                    : const Icon(Icons.attach_file_rounded, size: 18),
                                label: Text((attachments[i]['filename'] ?? 'anexo').toString(),
                                    overflow: TextOverflow.ellipsis),
                                onPressed: _downloading != null ? () {} : () => _downloadAttachment(i, (attachments[i]['filename'] ?? 'anexo').toString()),
                              ),
                          ]),
                        ],
                        const Divider(height: 28, color: line),
                        if ((full['html'] ?? '').toString().isNotEmpty)
                          HtmlWidget(full['html'])
                        else
                          Text((full['text'] ?? '').toString()),
                      ]),
                    ),
                  ),
                  _replyBar(full, f),
                ]),
    );
  }

  Widget _replyBar(Map full, Map f) {
    return Container(
      decoration: const BoxDecoration(color: surface, border: Border(top: BorderSide(color: line))),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      child: SafeArea(top: false, child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
        _barBtn(Icons.reply_rounded, 'Responder', () => _compose(
            to: f['address']?.toString(), subject: _reSubject(full['subject']?.toString()), body: _quote(full))),
        _barBtn(Icons.reply_all_rounded, 'Todos', () => _compose(
            to: f['address']?.toString(), cc: _replyAllCc(full),
            subject: _reSubject(full['subject']?.toString()), body: _quote(full))),
        _barBtn(Icons.forward_rounded, 'Encaminhar', () => _compose(
            subject: _fwdSubject(full['subject']?.toString()), body: _quote(full, forward: true))),
      ])),
    );
  }

  Widget _barBtn(IconData icon, String label, VoidCallback onTap) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 22, color: accent),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 11, color: muted)),
          ]),
        ),
      ),
    );
  }
}

// ---------------- Compose ----------------
class _Attach {
  final String filename;
  final String data; // base64
  final int size;
  _Attach(this.filename, this.data, this.size);
}

class ComposeScreen extends StatefulWidget {
  final List accounts;
  final int? fixedAccountId;
  final String? to;
  final String? cc;
  final String? subject;
  final String? body;
  const ComposeScreen({super.key, required this.accounts, this.fixedAccountId, this.to, this.cc, this.subject, this.body});
  @override
  State<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends State<ComposeScreen> {
  int? _accountId;
  late TextEditingController _to;
  late TextEditingController _cc;
  late TextEditingController _bcc;
  late TextEditingController _subject;
  late TextEditingController _body;
  bool _showCc = false;
  bool _sending = false;
  String? _msg;
  final List<_Attach> _attachments = [];

  @override
  void initState() {
    super.initState();
    _accountId = widget.fixedAccountId ?? (widget.accounts.isNotEmpty ? widget.accounts[0]['id'] : null);
    _to = TextEditingController(text: widget.to ?? '');
    _cc = TextEditingController(text: widget.cc ?? '');
    _bcc = TextEditingController();
    _subject = TextEditingController(text: widget.subject ?? '');
    _body = TextEditingController(text: widget.body ?? '');
    _showCc = (widget.cc ?? '').isNotEmpty;
  }

  @override
  void dispose() {
    _to.dispose(); _cc.dispose(); _bcc.dispose(); _subject.dispose(); _body.dispose();
    super.dispose();
  }

  Future<void> _pickFiles() async {
    final res = await FilePicker.pickFiles(allowMultiple: true, withData: true);
    if (res == null) return;
    int total = _attachments.fold(0, (s, a) => s + a.size);
    for (final file in res.files) {
      final bytes = file.bytes;
      if (bytes == null) continue;
      if (total + bytes.length > 20 * 1024 * 1024) {
        setState(() => _msg = 'Anexos excedem 20MB.');
        break;
      }
      total += bytes.length;
      _attachments.add(_Attach(file.name, base64Encode(bytes), bytes.length));
    }
    if (mounted) setState(() {});
  }

  String _fmtSize(int n) {
    if (n < 1024) return '$n B';
    if (n < 1048576) return '${(n / 1024).toStringAsFixed(0)} KB';
    return '${(n / 1048576).toStringAsFixed(1)} MB';
  }

  Future<void> _send() async {
    if (_to.text.trim().isEmpty) { setState(() => _msg = 'Informe o destinatário.'); return; }
    setState(() { _sending = true; _msg = null; });
    try {
      await Api.send(_accountId!, {
        'to': _to.text.trim(),
        if (_cc.text.trim().isNotEmpty) 'cc': _cc.text.trim(),
        if (_bcc.text.trim().isNotEmpty) 'bcc': _bcc.text.trim(),
        'subject': _subject.text,
        'text': _body.text,
        if (_attachments.isNotEmpty)
          'attachments': _attachments.map((a) => {'filename': a.filename, 'data': a.data}).toList(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Mensagem enviada')));
        Navigator.pop(context);
      }
    } catch (e) {
      setState(() { _msg = e.toString(); _sending = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Nova mensagem'), actions: [
        IconButton(
          icon: const Icon(Icons.send_rounded),
          onPressed: _sending || _accountId == null ? null : _send,
        ),
      ]),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (widget.accounts.isNotEmpty)
              DropdownButtonFormField<int>(
                initialValue: _accountId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'De', border: OutlineInputBorder(), isDense: true),
                items: widget.accounts.cast<Map>().map((a) => DropdownMenuItem<int>(
                    value: a['id'], child: Text(a['email'], overflow: TextOverflow.ellipsis))).toList(),
                onChanged: (v) => setState(() => _accountId = v),
              ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: TextField(controller: _to, decoration: const InputDecoration(labelText: 'Para', border: OutlineInputBorder(), isDense: true))),
              TextButton(onPressed: () => setState(() => _showCc = !_showCc), child: const Text('Cc/Cco')),
            ]),
            if (_showCc) ...[
              const SizedBox(height: 10),
              TextField(controller: _cc, decoration: const InputDecoration(labelText: 'Cc', border: OutlineInputBorder(), isDense: true)),
              const SizedBox(height: 10),
              TextField(controller: _bcc, decoration: const InputDecoration(labelText: 'Cco', border: OutlineInputBorder(), isDense: true)),
            ],
            const SizedBox(height: 10),
            TextField(controller: _subject, decoration: const InputDecoration(labelText: 'Assunto', border: OutlineInputBorder(), isDense: true)),
            const SizedBox(height: 10),
            Expanded(
              child: TextField(
                controller: _body,
                maxLines: null, expands: true, textAlignVertical: TextAlignVertical.top,
                decoration: const InputDecoration(
                    labelText: 'Mensagem', border: OutlineInputBorder(), alignLabelWithHint: true),
              ),
            ),
            const SizedBox(height: 8),
            Row(children: [
              OutlinedButton.icon(
                onPressed: _pickFiles,
                icon: const Icon(Icons.attach_file_rounded, size: 18),
                label: const Text('Anexar'),
              ),
            ]),
            if (_attachments.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Wrap(spacing: 8, runSpacing: 8, children: [
                  for (int i = 0; i < _attachments.length; i++)
                    Chip(
                      label: Text('${_attachments[i].filename}  ·  ${_fmtSize(_attachments[i].size)}',
                          style: const TextStyle(fontSize: 12)),
                      onDeleted: () => setState(() => _attachments.removeAt(i)),
                      deleteIcon: const Icon(Icons.close, size: 16),
                    ),
                ]),
              ),
            if (_sending) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator()),
            if (_msg != null)
              Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg!, style: const TextStyle(color: Colors.redAccent))),
          ]),
        ),
      ),
    );
  }
}

// ---------------- Accounts ----------------
class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key});
  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  List _accounts = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      _accounts = await Api.accounts();
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _addDialog() async {
    final name = TextEditingController();
    final email = TextEditingController();
    final pass = TextEditingController();
    String? result;
    Map oauth = {};
    try { oauth = await Api.oauthStatus(); } catch (_) {}
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setD) {
        Future<void> oauthLogin(String provider) async {
          Navigator.pop(ctx); // fecha o diálogo antes de abrir o navegador
          final ok = await runOAuthFlow(context, provider);
          if (!mounted) return;
          if (ok) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Conta conectada.')));
            _load();
          }
        }
        Future<void> test() async {
          setD(() => result = 'Testando...');
          try {
            final r = await Api.testAccount({'displayName': name.text, 'email': email.text.trim(), 'password': pass.text});
            setD(() => result = 'IMAP: ${r['imap'] ? 'ok' : 'falhou'}   SMTP: ${r['smtp'] ? 'ok' : 'falhou'}');
          } catch (e) { setD(() => result = 'Erro: $e'); }
        }
        Future<void> save() async {
          setD(() => result = 'Salvando...');
          try {
            await Api.addAccount({'displayName': name.text, 'email': email.text.trim(), 'password': pass.text});
            if (ctx.mounted) Navigator.pop(ctx);
            _load();
          } catch (e) { setD(() => result = 'Erro: $e'); }
        }
        return AlertDialog(
          title: const Text('Adicionar conta'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (oauth['microsoft'] == true)
                Padding(padding: const EdgeInsets.only(bottom: 8),
                    child: oauthButton('microsoft', 'Entrar com a Microsoft', () => oauthLogin('microsoft'))),
              if (oauth['google'] == true)
                Padding(padding: const EdgeInsets.only(bottom: 8),
                    child: oauthButton('google', 'Entrar com o Google', () => oauthLogin('google'))),
              if (oauth['microsoft'] == true || oauth['google'] == true)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 6),
                  child: Row(children: [
                    Expanded(child: Divider(color: line)),
                    Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('ou senha de app', style: TextStyle(fontSize: 12, color: muted))),
                    Expanded(child: Divider(color: line)),
                  ]),
                ),
              TextField(controller: name, decoration: const InputDecoration(labelText: 'Nome')),
              TextField(controller: email, decoration: const InputDecoration(labelText: 'Email')),
              TextField(controller: pass, obscureText: true, decoration: const InputDecoration(labelText: 'Senha de app')),
              const SizedBox(height: 8),
              const Text('Gmail e Outlook exigem "Senha de app".', style: TextStyle(fontSize: 12, color: muted)),
              if (result != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(result!)),
            ]),
          ),
          actions: [
            TextButton(onPressed: test, child: const Text('Testar')),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
            FilledButton(onPressed: save, child: const Text('Salvar')),
          ],
        );
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contas')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: accent, onPressed: _addDialog, child: const Icon(Icons.add_rounded)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _accounts.isEmpty
              ? const Center(child: Text('Nenhuma conta ainda.', style: TextStyle(color: muted)))
              : ListView(
                  children: _accounts.cast<Map>().map((a) => ListTile(
                        leading: AccountAvatar(account: a, size: 40),
                        title: Text(a['displayName']?.toString().isNotEmpty == true ? a['displayName'] : a['email']),
                        subtitle: Text('${a['email']} · ${a['authType'] == 'oauth' ? a['provider'] ?? 'oauth' : 'senha'}'),
                        trailing: IconButton(
                          icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                          onPressed: () async {
                            final ok = await showDialog<bool>(
                              context: context,
                              builder: (ctx) => AlertDialog(
                                title: const Text('Remover conta'),
                                content: Text('Remover ${a['email']} do FluxoryBox?'),
                                actions: [
                                  TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
                                  FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remover')),
                                ],
                              ),
                            );
                            if (ok == true) { await Api.deleteAccount(a['id']); _load(); }
                          },
                        ),
                      )).toList(),
                ),
    );
  }
}

// ---------------- Shared ----------------
// ---------------- OAuth (login Microsoft/Google via navegador) ----------------
// Abre o fluxo no navegador do sistema (o Google bloqueia OAuth em WebView embutido) e
// detecta a conclusão por polling em /api/accounts: conta nova (add) ou conta que voltou
// a ficar conectada (reconnect).
Future<bool> runOAuthFlow(BuildContext context, String provider, {String? reconnectEmail}) async {
  final before = <String>{};
  try {
    for (final a in await Api.accounts()) {
      before.add(a['email'].toString().toLowerCase());
    }
  } catch (_) {}

  bool launched = false;
  try {
    launched = await launchUrl(Uri.parse(Api.oauthStartUrl(provider)), mode: LaunchMode.externalApplication);
  } catch (_) {}
  if (!launched) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Não foi possível abrir o navegador.')));
    }
    return false;
  }

  Future<bool> check() async {
    try {
      final accs = (await Api.accounts()).cast<Map>();
      if (reconnectEmail != null) {
        final a = accs.firstWhere(
            (x) => x['email'].toString().toLowerCase() == reconnectEmail.toLowerCase(),
            orElse: () => {});
        return a.isNotEmpty && a['disconnected'] != true;
      }
      final now = accs.map((x) => x['email'].toString().toLowerCase()).toSet();
      return now.difference(before).isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  if (!context.mounted) return false;
  final ok = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _OAuthWaitDialog(check: check, provider: provider),
  );
  return ok == true;
}

class _OAuthWaitDialog extends StatefulWidget {
  final Future<bool> Function() check;
  final String provider;
  const _OAuthWaitDialog({required this.check, required this.provider});
  @override
  State<_OAuthWaitDialog> createState() => _OAuthWaitDialogState();
}

class _OAuthWaitDialogState extends State<_OAuthWaitDialog> {
  Timer? _timer;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _tick());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _tick() async {
    if (_busy) return;
    _busy = true;
    final ok = await widget.check();
    _busy = false;
    if (ok && mounted) {
      _timer?.cancel();
      Navigator.pop(context, true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.provider == 'microsoft' ? 'Microsoft' : 'Google';
    return AlertDialog(
      title: Text('Entrar com $name'),
      content: const Row(mainAxisSize: MainAxisSize.min, children: [
        SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
        SizedBox(width: 14),
        Expanded(child: Text(
            'Conclua o login no navegador que abriu. Ao terminar, volte para o app — a conexão é detectada automaticamente.',
            style: TextStyle(fontSize: 13))),
      ]),
      actions: [
        TextButton(onPressed: () { _timer?.cancel(); Navigator.pop(context, false); }, child: const Text('Cancelar')),
        FilledButton(onPressed: _tick, child: const Text('Já concluí')),
      ],
    );
  }
}

// Botão de provedor com logo vetorial (sem emoji).
Widget oauthButton(String provider, String label, VoidCallback onTap) {
  return OutlinedButton(
    onPressed: onTap,
    style: OutlinedButton.styleFrom(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
      side: const BorderSide(color: line),
      foregroundColor: Colors.white,
    ),
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      SizedBox(width: 20, height: 20, child: provider == 'microsoft' ? const _MicrosoftLogo() : const _GoogleLogo()),
      const SizedBox(width: 12),
      Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
    ]),
  );
}

class _MicrosoftLogo extends StatelessWidget {
  const _MicrosoftLogo();
  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2, mainAxisSpacing: 2, crossAxisSpacing: 2,
      physics: const NeverScrollableScrollPhysics(),
      children: const [
        ColoredBox(color: Color(0xFFF25022)),
        ColoredBox(color: Color(0xFF7FBA00)),
        ColoredBox(color: Color(0xFF00A4EF)),
        ColoredBox(color: Color(0xFFFFB900)),
      ],
    );
  }
}

class _GoogleLogo extends StatelessWidget {
  const _GoogleLogo();
  @override
  Widget build(BuildContext context) {
    return const CustomPaint(painter: _GooglePainter());
  }
}

// "G" do Google desenhado com as 4 cores (aproximação vetorial).
class _GooglePainter extends CustomPainter {
  const _GooglePainter();
  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = size.width / 2;
    final sw = size.width * 0.22;
    final rect = Rect.fromCircle(center: c, radius: r - sw / 2);
    final p = Paint()..style = PaintingStyle.stroke..strokeWidth = sw..strokeCap = StrokeCap.butt;
    p.color = const Color(0xFF4285F4); canvas.drawArc(rect, -0.35, 1.4, false, p);   // azul (direita)
    p.color = const Color(0xFF34A853); canvas.drawArc(rect, 1.15, 1.4, false, p);    // verde (baixo)
    p.color = const Color(0xFFFBBC05); canvas.drawArc(rect, 2.6, 1.2, false, p);     // amarelo (esquerda)
    p.color = const Color(0xFFEA4335); canvas.drawArc(rect, 3.7, 1.3, false, p);     // vermelho (cima)
    // barra horizontal do "G"
    final bar = Paint()..color = const Color(0xFF4285F4)..strokeWidth = sw..strokeCap = StrokeCap.butt;
    canvas.drawLine(c, Offset(c.dx + r - sw / 2, c.dy), bar);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// Placeholders animados (shimmer) enquanto carrega uma caixa pela 1ª vez.
class _SkeletonList extends StatefulWidget {
  const _SkeletonList();
  @override
  State<_SkeletonList> createState() => _SkeletonListState();
}

class _SkeletonListState extends State<_SkeletonList> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);

  @override
  void dispose() { _c.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: 10,
      separatorBuilder: (_, __) => const SizedBox(height: 2),
      itemBuilder: (_, __) => AnimatedBuilder(
        animation: _c,
        builder: (_, __) {
          final o = 0.35 + _c.value * 0.35;
          Widget bar(double w, double h) => Container(
                width: w, height: h,
                decoration: BoxDecoration(
                  color: surface2.withValues(alpha: o),
                  borderRadius: BorderRadius.circular(6),
                ),
              );
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(width: 42, height: 42,
                  decoration: BoxDecoration(color: surface2.withValues(alpha: o), borderRadius: BorderRadius.circular(12))),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                bar(120, 11), const SizedBox(height: 9), bar(double.infinity, 11),
              ])),
            ]),
          );
        },
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  final VoidCallback? onReconnect;
  const _ErrorView({required this.error, required this.onRetry, this.onReconnect});
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(onReconnect != null ? Icons.link_off_rounded : Icons.error_outline,
              size: 48, color: const Color(0xFFFF6B7A)),
          const SizedBox(height: 12),
          Text(error, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          if (onReconnect != null)
            FilledButton.icon(
              onPressed: onReconnect,
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFFFF6B7A)),
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Reconectar conta'),
            )
          else
            FilledButton(onPressed: onRetry, child: const Text('Tentar de novo')),
          if (onReconnect != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: TextButton(onPressed: onRetry, child: const Text('Tentar de novo')),
            ),
        ]),
      ),
    );
  }
}
