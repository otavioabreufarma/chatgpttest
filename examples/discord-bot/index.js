import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  StringSelectMenuBuilder,
} from 'discord.js';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PANEL_CHANNEL_ID = process.env.PANEL_CHANNEL_ID;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

function buildPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Rust VIP • Vinculação')
    .setDescription('Clique no botão abaixo para vincular Discord + Steam e liberar compras.')
    .setColor(0x2f3136);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('link_accounts').setLabel('🔗 Vincular Contas').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

function buildDmComponents() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('select_server')
    .setPlaceholder('Escolha o servidor')
    .addOptions(
      { label: 'Servidor 1', value: 's1' },
      { label: 'Servidor 2', value: 's2' },
    );

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('buy_vip').setLabel('💎 Comprar VIP').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('buy_vip_plus').setLabel('💎 Comprar VIP+').setStyle(ButtonStyle.Secondary),
  );

  return [new ActionRowBuilder().addComponents(select), actions];
}

const userState = new Map();

async function createLink(discordId) {
  const response = await fetch(`${API_BASE_URL}/v1/link/discord/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discordId }),
  });

  if (!response.ok) throw new Error(`Link init failed: ${response.status}`);
  return response.json();
}

async function createOrder(discordId, serverSlug, planCode) {
  const response = await fetch(`${API_BASE_URL}/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discordId, serverSlug, planCode }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Order failed: ${response.status} ${text}`);
  }
  return response.json();
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot online: ${client.user.tag}`);

  if (!PANEL_CHANNEL_ID) return;
  const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  await channel.send(buildPanel());
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId === 'link_accounts') {
      await interaction.deferReply({ ephemeral: true });
      const payload = await createLink(interaction.user.id);
      await interaction.editReply({
        content: `Faça a vinculação pela Steam: ${payload.steamAuthUrl}`,
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_server') {
      userState.set(interaction.user.id, { serverSlug: interaction.values[0] });
      await interaction.reply({ content: `Servidor selecionado: ${interaction.values[0]}`, ephemeral: true });
      return;
    }

    if (interaction.isButton() && ['buy_vip', 'buy_vip_plus'].includes(interaction.customId)) {
      const state = userState.get(interaction.user.id);
      if (!state?.serverSlug) {
        await interaction.reply({ content: 'Selecione o servidor antes de comprar.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const planCode = interaction.customId === 'buy_vip_plus' ? 'vip_plus' : 'vip';
      const order = await createOrder(interaction.user.id, state.serverSlug, planCode);
      await interaction.editReply(`Pedido criado (${order.orderNsu}). Pague aqui: ${order.checkoutUrl}`);
      return;
    }
  } catch (error) {
    const message = `Erro: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content === '!vip-menu') {
    await message.author.send({
      content: '✅ Contas vinculadas com sucesso! Escolha servidor e plano:',
      components: buildDmComponents(),
    });
  }
});

if (!BOT_TOKEN) {
  throw new Error('Defina DISCORD_BOT_TOKEN');
}

client.login(BOT_TOKEN);
