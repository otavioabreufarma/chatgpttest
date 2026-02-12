export const config = {
  app: {
    port: Number(process.env.PORT || 3000),
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
    linkTokenTtlMinutes: Number(process.env.LINK_TOKEN_TTL_MINUTES || 15),
  },
  steam: {
    apiKey: process.env.STEAM_API_KEY || '',
  },
  infinityPay: {
    baseUrl: process.env.INFINITYPAY_BASE_URL || 'https://api.infinitepay.io',
    token: process.env.INFINITYPAY_TOKEN || '',
    sellerHandle: process.env.INFINITYPAY_SELLER_HANDLE || '',
    webhookSecret: process.env.INFINITYPAY_WEBHOOK_SECRET || '',
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    vipRoleId: process.env.DISCORD_VIP_ROLE_ID || '',
    vipPlusRoleId: process.env.DISCORD_VIP_PLUS_ROLE_ID || '',
  },
  rustServers: {
    alpha: {
      id: 'alpha',
      name: process.env.RUST_SERVER_ALPHA_NAME || 'Servidor Alpha',
      grantEndpoint: process.env.RUST_SERVER_ALPHA_GRANT_ENDPOINT || '',
      revokeEndpoint: process.env.RUST_SERVER_ALPHA_REVOKE_ENDPOINT || '',
      authToken: process.env.RUST_SERVER_ALPHA_TOKEN || '',
    },
    beta: {
      id: 'beta',
      name: process.env.RUST_SERVER_BETA_NAME || 'Servidor Beta',
      grantEndpoint: process.env.RUST_SERVER_BETA_GRANT_ENDPOINT || '',
      revokeEndpoint: process.env.RUST_SERVER_BETA_REVOKE_ENDPOINT || '',
      authToken: process.env.RUST_SERVER_BETA_TOKEN || '',
    },
  },
  plans: {
    vip: {
      id: 'vip',
      name: 'VIP',
      priceCents: Number(process.env.VIP_PRICE_CENTS || 2500),
      durationDays: Number(process.env.VIP_DURATION_DAYS || 30),
    },
    vip_plus: {
      id: 'vip_plus',
      name: 'VIP+',
      priceCents: Number(process.env.VIP_PLUS_PRICE_CENTS || 4500),
      durationDays: Number(process.env.VIP_PLUS_DURATION_DAYS || 30),
    },
  },
  expiration: {
    checkIntervalMs: Number(process.env.EXPIRATION_CHECK_INTERVAL_MS || 60000),
  },
};

export const isConfigured = {
  infinityPay: Boolean(config.infinityPay.token),
  discord: Boolean(config.discord.botToken && config.discord.guildId),
  steam: Boolean(config.steam.apiKey),
};
