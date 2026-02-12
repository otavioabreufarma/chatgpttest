import crypto from 'node:crypto';
import { config } from './config.js';

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';

export function buildSteamLoginUrl(returnTo, realm) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID}?${params.toString()}`;
}

export async function verifySteamLogin(query) {
  const params = new URLSearchParams(query);
  params.set('openid.mode', 'check_authentication');

  const response = await fetch(STEAM_OPENID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const body = await response.text();
  const isValid = body.includes('is_valid:true');
  if (!isValid) return null;

  const claimedId = query['openid.claimed_id'];
  if (!claimedId) return null;
  const match = claimedId.match(/\/id\/(\d+)$/);
  return match?.[1] || null;
}

export async function fetchSteamProfile(steamId) {
  if (!config.steam.apiKey) {
    return { personaname: `Steam ${steamId}` };
  }
  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');
  url.searchParams.set('key', config.steam.apiKey);
  url.searchParams.set('steamids', steamId);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Steam API error: ${response.status}`);
  }
  const payload = await response.json();
  return payload?.response?.players?.[0] || { personaname: `Steam ${steamId}` };
}

export function signWebhookBody(raw) {
  return crypto.createHmac('sha256', config.infinityPay.webhookSecret).update(raw).digest('hex');
}

export async function createInfinityPayCheckout({ amountCents, planName, reference }) {
  if (!config.infinityPay.token || !config.infinityPay.sellerHandle) {
    return {
      id: `mock_${reference}`,
      checkoutUrl: `${config.app.baseUrl}/mock-checkout-success?reference=${reference}`,
      isMock: true,
    };
  }

  const endpoint = `${config.infinityPay.baseUrl}/invoices/public/checkout/links`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.infinityPay.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      handle: config.infinityPay.sellerHandle,
      webhook_url: `${config.app.baseUrl}/api/infinitypay/webhook`,
      order_nsu: reference,
      items: [
        {
          description: planName,
          quantity: 1,
          price: amountCents,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`InfinityPay checkout failure: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return {
    id: payload.id || payload.checkout_id || payload.invoice_id,
    checkoutUrl: payload.url || payload.checkout_url || payload.link,
    isMock: false,
  };
}

async function postToRustBridge(endpoint, token, payload) {
  if (!endpoint) return { skipped: true };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Rust bridge error ${response.status}: ${text}`);
  }
  return { skipped: false };
}

export async function grantInGameVip(server, { steamId, planId, expiresAt }) {
  return postToRustBridge(server.grantEndpoint, server.authToken, {
    steamId,
    planId,
    expiresAt,
  });
}

export async function revokeInGameVip(server, { steamId, planId }) {
  return postToRustBridge(server.revokeEndpoint, server.authToken, {
    steamId,
    planId,
  });
}

export async function addDiscordRole(discordId, roleId) {
  if (!config.discord.botToken || !config.discord.guildId || !discordId || !roleId) return { skipped: true };

  const endpoint = `https://discord.com/api/v10/guilds/${config.discord.guildId}/members/${discordId}/roles/${roleId}`;
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${config.discord.botToken}`,
      'Content-Length': '0',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord role add failed ${response.status}: ${text}`);
  }
  return { skipped: false };
}

export async function removeDiscordRole(discordId, roleId) {
  if (!config.discord.botToken || !config.discord.guildId || !discordId || !roleId) return { skipped: true };

  const endpoint = `https://discord.com/api/v10/guilds/${config.discord.guildId}/members/${discordId}/roles/${roleId}`;
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${config.discord.botToken}` },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Discord role remove failed ${response.status}: ${text}`);
  }
  return { skipped: false };
}
