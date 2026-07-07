# 📬 FluxoryBox — Cliente de Email próprio

Cliente de email multi-conta (Gmail, Outlook/Hotmail, outros) com **backend único**,
**web app** e **app Android (Flutter)**. Sem depender do Outlook/Gmail app.

## Arquitetura

```
Web app (browser) ─┐
                   ├─ HTTPS/REST ─→ Backend Node (Discloud) ─ IMAP/SMTP ─→ Gmail / Outlook / ...
APK Android ───────┘
```

- **1 app só na Discloud** (`fluxorybox`) serve a API **e** a interface web.
- O APK Android consome a mesma API.
- Autenticação das contas via **Senha de App** (App Password) — sem OAuth.

## URLs / acesso

- Web app: **https://fluxorybox.discloud.app**
- API: mesma origem, prefixo `/api`
- Token de acesso (Bearer): fica no `backend/.env` (`API_TOKEN`). Cole na tela de login.

## Estrutura

| Pasta | O quê |
|-------|-------|
| `backend/` | API Fastify + IMAP (imapflow) + SMTP (nodemailer) + web app estático (`public/`) |
| `mobile/`  | App Flutter (Android) |
| `dist/FluxoryBox.apk` | APK release pronto pra instalar |

## Backend — rodar local

```bash
cd backend
npm install
# defina MASTER_KEY e API_TOKEN no .env (veja .env.example)
PORT=3000 node src/server.js
# abre http://localhost:3000
```

### Endpoints principais
- `GET  /health`
- `GET  /api/providers` — provedores suportados
- `GET/POST/DELETE /api/accounts` — gerenciar contas
- `POST /api/accounts/test` — testar credenciais (IMAP+SMTP)
- `GET  /api/inbox` — caixa unificada (todas as contas)
- `GET  /api/accounts/:id/folders` — pastas
- `GET  /api/accounts/:id/messages` — listar
- `GET  /api/accounts/:id/messages/:uid` — ler
- `POST /api/accounts/:id/messages/:uid/flags` — marcar lido/favorito
- `POST /api/accounts/:id/messages/:uid/move` — arquivar/lixeira
- `POST /api/accounts/:id/send` — enviar

Todas as rotas `/api/*` exigem header `Authorization: Bearer <API_TOKEN>`.

## Senhas de App (obrigatório)

- **Gmail**: ative Verificação em 2 etapas → https://myaccount.google.com/apppasswords → gere uma senha.
- **Outlook/Hotmail**: https://account.microsoft.com/security → Opções avançadas → Senhas de aplicativo.
- Use essa senha (não a senha normal) ao adicionar a conta.

## Persistência na Discloud ⚠️

O filesystem da Discloud é **zerado a cada deploy**. O SQLite (`data/mail.db`) guarda as
contas e **sobrevive a restarts, mas não a redeploys**. Para as contas voltarem sozinhas
após um redeploy, preencha `SEED_ACCOUNTS` no `.env` (JSON) — elas são re-semeadas no boot:

```
SEED_ACCOUNTS=[{"email":"voce@gmail.com","password":"senha-de-app","displayName":"Você"}]
```

(Alternativa robusta futura: apontar pra um Postgres separado na Discloud.)

## Deploy (Discloud)

```bash
cd backend
discloud app commit fluxorybox   # atualizar código
# primeira vez foi: discloud app upload
```

`discloud.config`: `TYPE=site`, `MAIN=src/server.js`, `RAM=512`, `ID=fluxorybox`.
O app escuta em `process.env.PORT || 8080` (Caddy faz proxy pra 8080).

## App Android

- APK pronto: `dist/FluxoryBox.apk`
- Rebuild: `cd mobile && flutter build apk --release`
- Na 1ª abertura: informe a URL (`https://fluxorybox.discloud.app`) e o token.
