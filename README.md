# Rust VIP Shop (MVP funcional)

Sistema online para vender VIP/VIP+ para servidor Rust com:

- Login com Steam (OpenID)
- Seleção de servidor (Alpha/Beta)
- Checkout InfinityPay
- Aplicação automática de VIP in-game via endpoint bridge
- Cargo automático no Discord
- Revogação automática ao expirar (in-game e Discord)

## Como rodar

```bash
cp .env.example .env
npm start
```

Acesse: `http://localhost:3000`

## Fluxo completo

1. Jogador faz login com Steam.
2. Seleciona servidor e plano (VIP ou VIP+).
3. Sistema cria checkout na InfinityPay.
4. InfinityPay envia webhook de pagamento aprovado.
5. Sistema concede VIP no servidor escolhido + cargo Discord.
6. Job de expiração roda periodicamente e remove VIP/cargo quando expirar.

## Integração com servidor Rust

Este MVP usa **endpoints bridge** HTTP por servidor:

- `RUST_SERVER_ALPHA_GRANT_ENDPOINT`
- `RUST_SERVER_ALPHA_REVOKE_ENDPOINT`
- `RUST_SERVER_BETA_GRANT_ENDPOINT`
- `RUST_SERVER_BETA_REVOKE_ENDPOINT`

Você pode apontar para um microserviço seu que execute comandos RCON/Oxide no servidor, por exemplo:

- Grant: `oxide.grant group <steamId> vip`
- Revoke: `oxide.revoke group <steamId> vip`

Payload enviado (grant):

```json
{ "steamId": "7656...", "planId": "vip", "expiresAt": "2026-03-20T...Z" }
```

Payload enviado (revoke):

```json
{ "steamId": "7656...", "planId": "vip" }
```

## Integração Discord

Configure:

- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_VIP_ROLE_ID`
- `DISCORD_VIP_PLUS_ROLE_ID`

Jogador precisa informar o `Discord ID` no painel antes/apos compra.

## Modo sem InfinityPay (desenvolvimento)

Se `INFINITYPAY_TOKEN` estiver vazio, o sistema cria checkout mock e aplica compra automaticamente em `/mock-checkout-success`.

## Estrutura

- `src/server.js`: servidor HTTP + rotas API + webhook + expiração
- `src/services.js`: integrações (Steam, InfinityPay, Rust bridge, Discord)
- `src/db.js`: persistência JSON local
- `public/*`: frontend simples

## Produção recomendada

- Reverse proxy (Nginx) com HTTPS
- Persistência robusta (PostgreSQL)
- Fila para eventos de webhook
- Idempotência avançada no webhook
- OAuth2 Discord para vínculo automático (ao invés de Discord ID manual)
