# Sistema VIP Rust (Discord + Steam + InfinitePay + Backend + uMod)

## 1) Arquitetura geral

Componentes:

1. **Discord Bot (Node.js + discord.js)**
   - Publica embed fixa no canal `#vip` com botão **Vincular Contas**.
   - Envia DM com menu de servidor + botões de compra.
   - Consome endpoints do backend para link, criação de pedido e status.

2. **Backend API (Node.js + Express/NestJS ou Node HTTP atual evoluído)**
   - Fonte de verdade de usuários, vínculos, pedidos, assinaturas e expiração.
   - Gera URL de login Steam OpenID com `state` assinado para vincular `discordId`.
   - Cria checkout na InfinitePay com `order_nsu` interno único.
   - Recebe webhook da InfinitePay e faz reconciliação/idempotência.
   - Expõe endpoints autenticados para plugin Rust consultar e sincronizar VIP.
   - Dispara notificações de expiração para Discord Bot e plugin.

3. **InfinitePay**
   - Checkout por link público.
   - Webhook de atualização transacional.

4. **Steam OpenID**
   - Login e obtenção de `steamid64`.

5. **Plugin Rust (Oxide/uMod C#)**
   - Polling/sync com backend para grants ativos/expirados.
   - Aplica/remover grupos/permissões/kit no servidor.
   - Mostra alertas in-game de ativação e expiração.

### Fluxo fim-a-fim (produção)

1. Usuário clica em **Vincular Contas** no Discord.
2. Bot chama backend `/v1/link/discord/init` e recebe URL Steam.
3. Usuário autentica Steam; callback grava vínculo `discord_id + steam_id`.
4. Backend sinaliza sucesso e bot envia DM com seletor de servidor e botões VIP/VIP+.
5. Bot chama `/v1/orders` e recebe `checkout_url` da InfinitePay.
6. Usuário paga; InfinitePay chama `/v1/webhooks/infinitepay`.
7. Backend valida assinatura + `order_nsu` + `transaction_nsu` + valor + status.
8. Backend ativa assinatura VIP e marca ordem como `PAID`.
9. Plugin Rust sincroniza e aplica grupos (online ou offline).
10. Scheduler dispara alertas D-3, D-1 e expiração (Discord DM + in-game).

---

## 2) Banco de dados sugerido (PostgreSQL)

```sql
-- Identidade principal do jogador
CREATE TABLE users (
  id UUID PRIMARY KEY,
  steam_id VARCHAR(32) UNIQUE NOT NULL,
  discord_id VARCHAR(32) UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rust_servers (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL, -- s1, s2
  name TEXT NOT NULL,
  api_token_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL, -- vip, vip_plus
  name TEXT NOT NULL,
  price_cents INT NOT NULL,
  duration_days INT NOT NULL,
  rust_group TEXT NOT NULL,
  discord_role_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY,
  order_nsu TEXT UNIQUE NOT NULL,
  transaction_nsu TEXT UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  server_id UUID NOT NULL REFERENCES rust_servers(id),
  plan_id UUID NOT NULL REFERENCES plans(id),
  amount_cents INT NOT NULL,
  status TEXT NOT NULL, -- PENDING, PAID, FAILED, REFUNDED
  checkout_url TEXT,
  provider_payload JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  server_id UUID NOT NULL REFERENCES rust_servers(id),
  plan_id UUID NOT NULL REFERENCES plans(id),
  order_id UUID REFERENCES orders(id),
  status TEXT NOT NULL, -- ACTIVE, EXPIRED, REVOKED
  start_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_alert_3d_at TIMESTAMPTZ,
  last_alert_1d_at TIMESTAMPTZ,
  expired_alert_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL, -- infinitepay
  event_key TEXT UNIQUE NOT NULL, -- transaction_nsu ou hash(payload)
  status TEXT NOT NULL, -- RECEIVED, PROCESSED, FAILED
  payload JSONB NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
```

Índices importantes:
- `orders(status, created_at)`
- `subscriptions(status, expires_at)`
- `users(discord_id)` e `users(steam_id)`

---

## 3) Endpoints REST (exemplo)

### Autenticação e vínculo
- `POST /v1/link/discord/init`
  - body: `{ "discordId": "123..." }`
  - response: `{ "steamAuthUrl": "..." }`
- `GET /v1/auth/steam/callback?state=...`
  - valida estado assinado + nonce + expiração
  - vincula `discordId` ao `steamId`

### Catálogo e pedido
- `GET /v1/catalog`
- `POST /v1/orders`
  - body: `{ "discordId": "...", "serverSlug":"s1", "planCode":"vip" }`
  - response: `{ "orderNsu":"ORD-...", "checkoutUrl":"..." }`

### Webhook InfinitePay
- `POST /v1/webhooks/infinitepay`
  - valida assinatura/token
  - valida `order_nsu`, `transaction_nsu`, `amount`
  - idempotência por `transaction_nsu`

### API plugin Rust
- `GET /v1/plugin/subscriptions/active?serverSlug=s1`
- `GET /v1/plugin/subscriptions/by-steam/:steamId?serverSlug=s1`
- `POST /v1/plugin/subscriptions/:id/ack-activated`
- `POST /v1/plugin/subscriptions/:id/ack-expired`

### Segurança plugin
- Opção simples: `Authorization: Bearer <token-por-servidor>`
- Opção robusta: HMAC
  - Header: `x-signature: sha256=<hex>`
  - Assina `timestamp + method + path + body`
  - Bloqueia replay com janela de 5 minutos

---

## 4) Regras de negócio críticas

1. **Compra sem jogador online**
   - assinatura fica `ACTIVE`; plugin aplica no próximo connect/sync.
2. **Troca de Discord**
   - fluxo de relink exige autenticação Steam novamente.
   - histórico de pedidos/subs permanece no usuário (`steam_id` é chave canônica).
3. **Fraude/tentativa de webhook falso**
   - validar assinatura, valor, `order_nsu`, status permitido e idempotência.
4. **Duplicidade de webhook**
   - tabela `webhook_events` + constraint unique evita double-grant.
5. **Conflito de assinatura**
   - extensão de prazo em vez de criar assinatura paralela para mesmo plano/servidor.

---

## 5) Scheduler de expiração

Jobs periódicos (ex.: a cada 5 minutos):
- `D-3`: `expires_at <= now()+3d` e `last_alert_3d_at IS NULL`
- `D-1`: `expires_at <= now()+1d` e `last_alert_1d_at IS NULL`
- `EXPIRADO`: `expires_at <= now()` e `status='ACTIVE'`

Ações:
- publicar evento para bot enviar DM.
- registrar em fila para plugin notificar in-game (se online) e remover grupo quando expirar.

