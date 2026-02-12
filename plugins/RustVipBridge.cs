using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries.Covalence;

namespace Oxide.Plugins
{
    [Info("RustVipBridge", "SeuNome", "1.0.0")]
    [Description("Sincroniza VIP com backend externo e aplica/revoga grupos automaticamente")]
    public class RustVipBridge : CovalencePlugin
    {
        private PluginConfig _config;
        private readonly Dictionary<string, SubscriptionPayload> _cache = new Dictionary<string, SubscriptionPayload>();

        private class PluginConfig
        {
            public string ApiBaseUrl = "https://api.seudominio.com";
            public string ServerSlug = "s1";
            public string ApiToken = "trocar-token";
            public int SyncIntervalSeconds = 60;
            public string VipGroup = "vip";
            public string VipPlusGroup = "vipplus";
        }

        private class SubscriptionPayload
        {
            [JsonProperty("subscriptionId")] public string SubscriptionId;
            [JsonProperty("steamId")] public string SteamId;
            [JsonProperty("planCode")] public string PlanCode;
            [JsonProperty("status")] public string Status;
            [JsonProperty("expiresAt")] public string ExpiresAt;
        }

        protected override void LoadDefaultConfig() => _config = new PluginConfig();

        protected override void LoadConfig()
        {
            base.LoadConfig();
            _config = Config.ReadObject<PluginConfig>() ?? new PluginConfig();
            SaveConfig();
        }

        protected override void SaveConfig() => Config.WriteObject(_config, true);

        private void Init()
        {
            timer.Every(_config.SyncIntervalSeconds, SyncActiveSubscriptions);
        }

        private void OnUserConnected(IPlayer player)
        {
            if (_cache.TryGetValue(player.Id, out var sub) && sub.Status == "ACTIVE")
            {
                player.Message($"[VIP] Seu {sub.PlanCode.ToUpper()} está ativo até {sub.ExpiresAt}");
            }
        }

        private void SyncActiveSubscriptions()
        {
            var url = $"{_config.ApiBaseUrl}/v1/plugin/subscriptions/active?serverSlug={_config.ServerSlug}";
            var headers = new Dictionary<string, string>
            {
                ["Authorization"] = $"Bearer {_config.ApiToken}",
                ["Content-Type"] = "application/json"
            };

            webrequest.Enqueue(url, null, (code, response) =>
            {
                if (code != 200 || string.IsNullOrEmpty(response))
                {
                    PrintWarning($"Sync falhou: HTTP {code}");
                    return;
                }

                var list = JsonConvert.DeserializeObject<List<SubscriptionPayload>>(response) ?? new List<SubscriptionPayload>();
                ApplyDelta(list);
            }, this, RequestMethod.GET, headers, 20f);
        }

        private void ApplyDelta(List<SubscriptionPayload> activeSubs)
        {
            var activeSteamIds = new HashSet<string>();

            foreach (var sub in activeSubs)
            {
                activeSteamIds.Add(sub.SteamId);
                _cache[sub.SteamId] = sub;

                var targetGroup = sub.PlanCode == "vip_plus" ? _config.VipPlusGroup : _config.VipGroup;
                permission.AddUserGroup(sub.SteamId, targetGroup);

                var player = players.FindPlayerById(sub.SteamId);
                player?.Message($"[VIP] {sub.PlanCode.ToUpper()} ativado. Expira em {sub.ExpiresAt}");
            }

            foreach (var entry in new Dictionary<string, SubscriptionPayload>(_cache))
            {
                if (activeSteamIds.Contains(entry.Key)) continue;

                permission.RemoveUserGroup(entry.Key, _config.VipGroup);
                permission.RemoveUserGroup(entry.Key, _config.VipPlusGroup);

                var player = players.FindPlayerById(entry.Key);
                player?.Message("[VIP] Seu VIP expirou.");

                _cache.Remove(entry.Key);
            }
        }
    }
}
