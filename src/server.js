import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { config } from './config.js';
import {
  bindDiscord,
  createOrExtendGrant,
  createPurchase,
  findOrCreateUserBySteam,
  findPurchaseByReference,
  getActiveGrantsByUser,
  getUserById,
  listExpiredActiveGrants,
  setGrantStatus,
  updatePurchase,
} from './db.js';
import {
  addDiscordRole,
  buildSteamLoginUrl,
  createInfinityPayCheckout,
  fetchSteamProfile,
  grantInGameVip,
  removeDiscordRole,
  revokeInGameVip,
  signWebhookBody,
  verifySteamLogin,
} from './services.js';

const sessions = new Map();

const publicDir = path.resolve('public');

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => c.split('=').map(decodeURIComponent)),
  );
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + config.app.sessionTtlHours * 60 * 60 * 1000;
  sessions.set(token, { userId, expiresAt });
  return token;
}

function getSession(req) {
  const sid = readCookies(req).sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  const user = getUserById(session.userId);
  return user ? { sid, user } : null;
}

function clearSession(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
}

function setSessionCookie(res, sid) {
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(publicDir, target);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };

  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: 'Faça login com a Steam para continuar.' });
    return null;
  }
  return session;
}

async function applyPurchase(purchase) {
  if (purchase.status === 'paid') return;
  const updated = updatePurchase(purchase.id, { status: 'paid', paidAt: new Date().toISOString() });
  const user = getUserById(updated.userId);
  const grant = createOrExtendGrant({
    purchaseId: updated.id,
    userId: updated.userId,
    steamId: updated.steamId,
    planId: updated.planId,
    serverId: updated.serverId,
    durationDays: updated.durationDays,
  });

  const server = config.rustServers[updated.serverId];
  await grantInGameVip(server, {
    steamId: updated.steamId,
    planId: updated.planId,
    expiresAt: grant.expiresAt,
  });

  const roleId = updated.planId === 'vip_plus' ? config.discord.vipPlusRoleId : config.discord.vipRoleId;
  if (user?.discordId) await addDiscordRole(user.discordId, roleId);
}

async function processExpirations() {
  const expired = listExpiredActiveGrants();
  for (const grant of expired) {
    try {
      const server = config.rustServers[grant.serverId];
      await revokeInGameVip(server, { steamId: grant.steamId, planId: grant.planId });
      const user = getUserById(grant.userId);
      if (user?.discordId) {
        const roleId = grant.planId === 'vip_plus' ? config.discord.vipPlusRoleId : config.discord.vipRoleId;
        await removeDiscordRole(user.discordId, roleId);
      }
      setGrantStatus(grant.id, 'expired');
      console.log(`Grant expired and revoked: ${grant.id}`);
    } catch (error) {
      console.error('Expiration job failed for grant', grant.id, error.message);
    }
  }
}

setInterval(processExpirations, config.expiration.checkIntervalMs);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, config.app.baseUrl);
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/auth/steam') {
    const returnTo = `${config.app.baseUrl}/auth/steam/callback`;
    const loginUrl = buildSteamLoginUrl(returnTo, config.app.baseUrl);
    res.writeHead(302, { Location: loginUrl });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/auth/steam/callback') {
    const steamId = await verifySteamLogin(Object.fromEntries(url.searchParams.entries()));
    if (!steamId) {
      res.writeHead(302, { Location: '/?error=steam_login_failed' });
      res.end();
      return;
    }
    const profile = await fetchSteamProfile(steamId);
    const user = findOrCreateUserBySteam(steamId, profile);
    const sid = createSession(user.id);
    setSessionCookie(res, sid);
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/auth/logout') {
    clearSession(res);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const session = getSession(req);
    if (!session) {
      json(res, 200, { user: null });
      return;
    }
    json(res, 200, {
      user: {
        id: session.user.id,
        steamId: session.user.steamId,
        displayName: session.user.displayName,
        avatar: session.user.avatar,
        discordId: session.user.discordId,
      },
      activeGrants: getActiveGrantsByUser(session.user.id),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/bind-discord') {
    const session = requireAuth(req, res);
    if (!session) return;
    const raw = await parseBody(req);
    const body = JSON.parse(raw.toString('utf8') || '{}');
    if (!body.discordId || !/^\d{17,20}$/.test(body.discordId)) {
      json(res, 400, { error: 'Discord ID inválido.' });
      return;
    }
    const user = bindDiscord(session.user.id, body.discordId);
    json(res, 200, { user });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/create-checkout') {
    const session = requireAuth(req, res);
    if (!session) return;
    const raw = await parseBody(req);
    const body = JSON.parse(raw.toString('utf8') || '{}');

    const plan = config.plans[body.planId];
    const serverConfig = config.rustServers[body.serverId];
    if (!plan || !serverConfig) {
      json(res, 400, { error: 'Plano ou servidor inválido.' });
      return;
    }

    const purchase = createPurchase({
      userId: session.user.id,
      steamId: session.user.steamId,
      planId: plan.id,
      serverId: serverConfig.id,
      durationDays: plan.durationDays,
      amountCents: plan.priceCents,
    });

    try {
      const checkout = await createInfinityPayCheckout({
        amountCents: plan.priceCents,
        planName: plan.name,
        reference: purchase.providerReference,
        metadata: {
          userId: session.user.id,
          steamId: session.user.steamId,
          planId: plan.id,
          serverId: serverConfig.id,
        },
      });

      updatePurchase(purchase.id, {
        providerCheckoutId: checkout.id,
        checkoutUrl: checkout.checkoutUrl,
        providerMode: checkout.isMock ? 'mock' : 'live',
      });

      json(res, 200, { checkoutUrl: checkout.checkoutUrl, reference: purchase.providerReference });
    } catch (error) {
      updatePurchase(purchase.id, { status: 'failed', failureReason: error.message });
      json(res, 502, { error: `Falha ao criar checkout: ${error.message}` });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/infinitypay/webhook') {
    const raw = await parseBody(req);
    const signature = req.headers['x-webhook-signature'];

    if (config.infinityPay.webhookSecret) {
      const expected = signWebhookBody(raw);
      if (signature !== expected) {
        json(res, 401, { error: 'Assinatura inválida.' });
        return;
      }
    }

    const event = JSON.parse(raw.toString('utf8') || '{}');
    const reference = event.external_reference || event.data?.external_reference;
    const status = event.status || event.data?.status;

    const purchase = findPurchaseByReference(reference);
    if (!purchase) {
      json(res, 404, { error: 'Compra não encontrada.' });
      return;
    }

    if (['paid', 'approved', 'succeeded'].includes(String(status).toLowerCase())) {
      try {
        await applyPurchase(purchase);
      } catch (error) {
        updatePurchase(purchase.id, { status: 'error', failureReason: error.message });
        json(res, 500, { error: error.message });
        return;
      }
    }

    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/mock-checkout-success') {
    const reference = url.searchParams.get('reference');
    const purchase = findPurchaseByReference(reference);
    if (purchase) {
      try {
        await applyPurchase(purchase);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Erro ao aplicar VIP: ${error.message}`);
        return;
      }
    }
    res.writeHead(302, { Location: '/?payment=success' });
    res.end();
    return;
  }

  if (await serveStatic(req, res, pathname)) return;

  json(res, 404, { error: 'Rota não encontrada.' });
});

server.listen(config.app.port, () => {
  console.log(`Servidor rodando em ${config.app.baseUrl}`);
});
