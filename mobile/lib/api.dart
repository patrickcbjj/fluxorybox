import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Cliente da API do FluxoryBox. Guarda baseUrl e token localmente.
class Api {
  static String baseUrl = '';
  static String token = '';

  static Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    baseUrl = p.getString('baseUrl') ?? '';
    token = p.getString('token') ?? '';
  }

  // Faz login com usuário e senha; guarda o token de sessão retornado.
  static Future<void> login(String url, String username, String password) async {
    baseUrl = url.trim().replaceAll(RegExp(r'/$'), '');
    final res = await http.post(
      Uri.parse('$baseUrl/api/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );
    if (res.statusCode != 200) {
      String msg = 'Falha no login';
      try { msg = jsonDecode(res.body)['error'] ?? msg; } catch (_) {}
      throw ApiException(msg);
    }
    token = jsonDecode(res.body)['token'] ?? '';
    final p = await SharedPreferences.getInstance();
    await p.setString('baseUrl', baseUrl);
    await p.setString('token', token);
  }

  static Future<void> logout() async {
    token = '';
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
  }

  static bool get configured => baseUrl.isNotEmpty && token.isNotEmpty;

  static Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (token.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  static Future<dynamic> _get(String path) async {
    final res = await http.get(Uri.parse('$baseUrl$path'), headers: _headers);
    return _handle(res);
  }

  static Future<dynamic> _post(String path, Map body) async {
    final res = await http.post(Uri.parse('$baseUrl$path'),
        headers: _headers, body: jsonEncode(body));
    return _handle(res);
  }

  static Future<dynamic> _delete(String path) async {
    // DELETE sem corpo NÃO pode mandar Content-Type: application/json — o Fastify
    // responde 400 ("Body cannot be empty..."). Só o header de auth aqui.
    final res = await http.delete(
      Uri.parse('$baseUrl$path'),
      headers: {if (token.isNotEmpty) 'Authorization': 'Bearer $token'},
    );
    return _handle(res);
  }

  static dynamic _handle(http.Response res) {
    if (res.statusCode == 401) throw ApiException('Sua sessão expirou. Entre novamente.', code: 'AUTH_SESSION');
    if (res.statusCode >= 400) {
      String msg = 'Não foi possível completar a ação. Tente de novo.';
      String? code;
      bool reconnect = false;
      try {
        final e = jsonDecode(res.body);
        if (e is Map) {
          if (e['error'] != null) msg = e['error'].toString();
          code = e['code']?.toString();
          reconnect = e['needsReconnect'] == true;
        }
      } catch (_) {/* corpo não-JSON: mantém a mensagem amigável */}
      throw ApiException(msg, code: code, needsReconnect: reconnect);
    }
    return res.body.isEmpty ? null : jsonDecode(res.body);
  }

  // ---- Endpoints ----
  static Future<List<dynamic>> accounts() async => await _get('/api/accounts');

  static Future<Map> inbox({int limit = 40}) async =>
      await _get('/api/inbox?limit=$limit');

  // Mensagens de uma pasta de uma conta (com paginação).
  static Future<Map> accountMessages(int accountId,
          {String folder = 'INBOX', int limit = 25, int offset = 0}) async =>
      await _get('/api/accounts/$accountId/messages'
          '?folder=${Uri.encodeComponent(folder)}&limit=$limit&offset=$offset');

  // Pastas de uma conta.
  static Future<List<dynamic>> folders(int accountId) async =>
      await _get('/api/accounts/$accountId/folders');

  static Future<Map> message(int accountId, int uid, String folder) async =>
      await _get('/api/accounts/$accountId/messages/$uid?folder=${Uri.encodeComponent(folder)}');

  // Marca/desmarca flags (\\Seen, \\Flagged).
  static Future<dynamic> setFlags(int accountId, int uid, String folder,
          {List<String> add = const [], List<String> remove = const []}) async =>
      await _post(
          '/api/accounts/$accountId/messages/$uid/flags?folder=${Uri.encodeComponent(folder)}',
          {'add': add, 'remove': remove});

  // Busca no servidor (IMAP SEARCH) — unificada ou por conta+pasta.
  static Future<Map> searchUnified(String q, {int limit = 40}) async =>
      await _get('/api/search?q=${Uri.encodeComponent(q)}&limit=$limit');

  static Future<Map> searchAccount(int accountId, String folder, String q,
          {int limit = 40}) async =>
      await _get('/api/accounts/$accountId/search'
          '?folder=${Uri.encodeComponent(folder)}&q=${Uri.encodeComponent(q)}&limit=$limit');

  // Baixa os bytes de um anexo (mantém o header de auth).
  static Future<Uint8List> attachmentBytes(
      int accountId, int uid, String folder, int index) async {
    final res = await http.get(
      Uri.parse(
          '$baseUrl/api/accounts/$accountId/messages/$uid/attachment/$index?folder=${Uri.encodeComponent(folder)}'),
      headers: {if (token.isNotEmpty) 'Authorization': 'Bearer $token'},
    );
    if (res.statusCode == 401) throw ApiException('Token inválido (401)');
    if (res.statusCode >= 400) throw ApiException('Falha ao baixar anexo (${res.statusCode})');
    return res.bodyBytes;
  }

  // Quais provedores OAuth (Microsoft/Google) o servidor tem configurados.
  static Future<Map> oauthStatus() async => await _get('/api/oauth/status');

  // URL de início do login OAuth (aberta no navegador do sistema). O token vai na query
  // porque a navegação top-level não manda header Authorization.
  static String oauthStartUrl(String provider) =>
      '$baseUrl/api/oauth/$provider/start?token=${Uri.encodeComponent(token)}';

  static Future<dynamic> testAccount(Map body) async =>
      await _post('/api/accounts/test', body);

  static Future<dynamic> addAccount(Map body) async =>
      await _post('/api/accounts', body);

  static Future<dynamic> deleteAccount(int id) async =>
      await _delete('/api/accounts/$id');

  static Future<dynamic> send(int accountId, Map body) async =>
      await _post('/api/accounts/$accountId/send', body);

  // Registra/remove o token FCM deste dispositivo pra receber push de email novo.
  static Future<dynamic> registerPush(String token) async =>
      await _post('/api/push/register', {'token': token});

  static Future<dynamic> unregisterPush(String token) async =>
      await _post('/api/push/unregister', {'token': token});

  static Future<dynamic> move(int accountId, int uid, String folder, String target) async =>
      await _post('/api/accounts/$accountId/messages/$uid/move?folder=${Uri.encodeComponent(folder)}',
          {'target': target});
}

class ApiException implements Exception {
  final String message;
  final String? code;
  final bool needsReconnect;
  ApiException(this.message, {this.code, this.needsReconnect = false});
  @override
  String toString() => message;
}
