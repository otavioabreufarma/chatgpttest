# Rust VIP Platform (Discord + Steam + InfinitePay + Rust uMod)

Implementação base para um sistema de venda/gestão de VIP para servidores Rust com foco em produção.

## O que este repositório entrega

- Backend Node.js com fluxo de autenticação Steam, criação de compra e processamento de webhook.
- Documento de arquitetura de produção (banco, endpoints, segurança, edge cases).
- Exemplo de bot Discord com painel/DM/select menu/botões para compra.
- Exemplo de plugin Rust (Oxide/uMod C#) para sincronizar VIP ativo e remover expirados.

## Estrutura

- `src/*`: backend atual (MVP funcional)
- `docs/production-design.md`: arquitetura completa para produção
- `examples/discord-bot/index.js`: fluxo Discord com interações
- `plugins/RustVipBridge.cs`: plugin Rust para sync e aplicação de grupos

## Backend local

```bash
cp .env.example .env
npm start
```

Acesse: `http://localhost:3000`

## Fluxo recomendado em produção

1. Usuário clica em **Vincular Contas** no Discord.
2. Bot chama backend para iniciar Steam OpenID.
3. Callback Steam grava vínculo `discordId + steamid64`.
4. DM exibe seletor de servidor e botões VIP/VIP+.
5. Backend gera ordem e link de checkout InfinitePay.
6. Webhook valida pagamento e ativa assinatura.
7. Plugin Rust sincroniza e aplica grupo/permissões.
8. Scheduler dispara avisos D-3, D-1 e expiração.

## Próximos passos para produção

- Migrar persistência JSON para PostgreSQL.
- Adicionar filas (BullMQ/RabbitMQ) para webhooks e notificações.
- Implementar HMAC entre plugin Rust e backend.
- Adicionar observabilidade (OpenTelemetry + logs estruturados).
