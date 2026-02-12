import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = path.resolve('data', 'db.json');

const defaultDb = {
  users: [],
  purchases: [],
  grants: [],
};

function load() {
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
    return structuredClone(defaultDb);
  }
  const raw = fs.readFileSync(dbPath, 'utf8');
  return { ...structuredClone(defaultDb), ...JSON.parse(raw) };
}

let db = load();

function save() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function findOrCreateUserBySteam(steamId, profile = {}) {
  let user = db.users.find((u) => u.steamId === steamId);
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      steamId,
      displayName: profile.personaname || `Steam-${steamId}`,
      avatar: profile.avatarfull || '',
      discordId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.users.push(user);
  } else {
    user.displayName = profile.personaname || user.displayName;
    user.avatar = profile.avatarfull || user.avatar;
    user.updatedAt = new Date().toISOString();
  }
  save();
  return user;
}

export function getUserById(id) {
  return db.users.find((u) => u.id === id) || null;
}

export function getUserByDiscordId(discordId) {
  return db.users.find((u) => u.discordId === discordId) || null;
}

export function bindDiscord(userId, discordId) {
  const user = getUserById(userId);
  if (!user) return null;
  user.discordId = discordId;
  user.updatedAt = new Date().toISOString();
  save();
  return user;
}

export function createPurchase(data) {
  const purchase = {
    id: crypto.randomUUID(),
    status: 'pending',
    providerCheckoutId: null,
    providerReference: `order_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...data,
  };
  db.purchases.push(purchase);
  save();
  return purchase;
}

export function updatePurchase(purchaseId, partial) {
  const purchase = db.purchases.find((p) => p.id === purchaseId);
  if (!purchase) return null;
  Object.assign(purchase, partial, { updatedAt: new Date().toISOString() });
  save();
  return purchase;
}

export function findPurchaseByReference(reference) {
  return db.purchases.find((p) => p.providerReference === reference) || null;
}

export function createOrExtendGrant({ purchaseId, userId, steamId, planId, serverId, durationDays }) {
  const now = Date.now();
  const durationMs = durationDays * 24 * 60 * 60 * 1000;
  const activeGrant = db.grants.find(
    (g) => g.userId === userId && g.planId === planId && g.serverId === serverId && g.status === 'active',
  );

  if (activeGrant) {
    const currentEnd = new Date(activeGrant.expiresAt).getTime();
    const base = currentEnd > now ? currentEnd : now;
    activeGrant.expiresAt = new Date(base + durationMs).toISOString();
    activeGrant.lastPurchaseId = purchaseId;
    activeGrant.updatedAt = new Date().toISOString();
    save();
    return activeGrant;
  }

  const grant = {
    id: crypto.randomUUID(),
    userId,
    steamId,
    planId,
    serverId,
    status: 'active',
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(now + durationMs).toISOString(),
    lastPurchaseId: purchaseId,
    updatedAt: new Date().toISOString(),
  };
  db.grants.push(grant);
  save();
  return grant;
}

export function listExpiredActiveGrants(nowIso = new Date().toISOString()) {
  return db.grants.filter((g) => g.status === 'active' && g.expiresAt <= nowIso);
}

export function setGrantStatus(grantId, status) {
  const grant = db.grants.find((g) => g.id === grantId);
  if (!grant) return null;
  grant.status = status;
  grant.updatedAt = new Date().toISOString();
  save();
  return grant;
}

export function getActiveGrantsByUser(userId) {
  return db.grants.filter((g) => g.userId === userId && g.status === 'active');
}

export function listActiveGrantsByServer(serverId) {
  return db.grants.filter((g) => g.serverId === serverId && g.status === 'active');
}
