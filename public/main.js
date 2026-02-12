const authSection = document.getElementById('auth-section');
const shopSection = document.getElementById('shop-section');
const userInfo = document.getElementById('user-info');
const statusEl = document.getElementById('status');
const discordInput = document.getElementById('discord-id');

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Erro inesperado');
  return payload;
}

async function loadUser() {
  const data = await api('/api/me');

  if (!data.user) {
    authSection.classList.remove('hidden');
    shopSection.classList.add('hidden');
    return;
  }

  authSection.classList.add('hidden');
  shopSection.classList.remove('hidden');

  userInfo.innerHTML = `
    <div class="row" style="align-items:center; margin-bottom: 12px;">
      <img src="${data.user.avatar}" alt="avatar" width="48" height="48" style="border-radius:999px" />
      <div>
        <strong>${data.user.displayName}</strong><br />
        SteamID: ${data.user.steamId}
      </div>
    </div>
  `;

  if (data.user.discordId) discordInput.value = data.user.discordId;
}

document.getElementById('save-discord').addEventListener('click', async () => {
  try {
    await api('/api/bind-discord', {
      method: 'POST',
      body: JSON.stringify({ discordId: discordInput.value.trim() }),
    });
    setStatus('Discord vinculado com sucesso!');
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelectorAll('[data-plan]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const planId = btn.dataset.plan;
    const serverId = document.getElementById('server-select').value;

    try {
      setStatus('Gerando checkout...');
      const data = await api('/api/create-checkout', {
        method: 'POST',
        body: JSON.stringify({ planId, serverId }),
      });
      window.location.href = data.checkoutUrl;
    } catch (error) {
      setStatus(error.message);
    }
  });
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.reload();
});

loadUser().catch((error) => setStatus(error.message));
