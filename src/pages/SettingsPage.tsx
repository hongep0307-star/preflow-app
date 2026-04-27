import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, ArrowLeft, Check, Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LOCAL_SERVER_AUTH_HEADERS, LOCAL_SERVER_BASE_URL } from "@shared/constants";
import ModelPicker from "@/components/common/ModelPicker";
import { invalidateSettingsCache } from "@/lib/settingsCache";
import { BrandLogo } from "@/components/common/BrandLogo";
import { MetaPill, SectionLabel } from "@/components/common/ui-primitives";
import { useUiLanguage, type UiLanguage } from "@/lib/uiLanguage";
import {
  DASHBOARD_CARDS_PER_ROW_OPTIONS,
  readDashboardCardsPerRow,
  saveDashboardCardsPerRow,
  type DashboardCardsPerRow,
} from "@/lib/dashboardPreferences";

const settingsApi = {
  get: async () => {
    const res = await fetch(`${LOCAL_SERVER_BASE_URL}/settings/get`, {
      method: "POST",
      headers: LOCAL_SERVER_AUTH_HEADERS,
    });
    return res.json();
  },
  set: async (s: any) => {
    const res = await fetch(`${LOCAL_SERVER_BASE_URL}/settings/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...LOCAL_SERVER_AUTH_HEADERS },
      body: JSON.stringify(s),
    });
    return res.json();
  },
};

interface SettingsState {
  anthropic_api_key: string;
  openai_api_key: string;
  google_service_account_key: string;
  google_cloud_project_id: string;
}
// NOTE: `gpt_5_5_api_enabled` was the preview flag gating GPT-5.5/5.5-pro
// before they hit GA. Both are now released:true in modelCatalog.ts so the
// flag is dead — we don't read or write it here anymore. Stored values in
// existing user DBs are simply ignored by the new code path.

const SettingsPage = () => {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useUiLanguage();
  const [settings, setSettings] = useState<SettingsState>({
    anthropic_api_key: "",
    openai_api_key: "",
    google_service_account_key: "",
    google_cloud_project_id: "",
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dashboardCardsPerRow, setDashboardCardsPerRow] =
    useState<DashboardCardsPerRow>(readDashboardCardsPerRow);

  useEffect(() => {
    settingsApi.get().then((s: any) => {
      setSettings({
        anthropic_api_key: s.anthropic_api_key ?? "",
        openai_api_key: s.openai_api_key ?? "",
        google_service_account_key: s.google_service_account_key ?? "",
        google_cloud_project_id: s.google_cloud_project_id ?? "",
      });
    });
  }, []);

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);
    await settingsApi.set(settings);
    // ModelPicker 등 가용성 캐시를 즉시 갱신
    await invalidateSettingsCache();
    setSaved(true);
    setLoading(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggle = (key: string) => setShowKeys(p => ({ ...p, [key]: !p[key] }));

  const handleDashboardCardsPerRowChange = (value: string) => {
    const next = Number(value) as DashboardCardsPerRow;
    if (!DASHBOARD_CARDS_PER_ROW_OPTIONS.includes(next)) return;
    setDashboardCardsPerRow(next);
    saveDashboardCardsPerRow(next);
  };

  const inputCls =
    "h-9 bg-surface-panel border-border-subtle text-[12px] text-foreground/80 placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:border-primary/30 rounded-none font-mono";

  const keyWarning = (key: keyof SettingsState, value: string): string | null => {
    if (!value || value.length < 5) return null;
    if (key === "openai_api_key" && value.startsWith("sk-ant-"))
      return "⚠ This looks like an Anthropic key. Please enter an OpenAI key (sk-proj-... or sk-...).";
    if (key === "anthropic_api_key" && (value.startsWith("sk-proj-") || (value.startsWith("sk-") && !value.startsWith("sk-ant-"))))
      return "⚠ This looks like an OpenAI key. Please enter an Anthropic key (sk-ant-...).";
    if (key === "google_service_account_key" && !value.trim().startsWith("{"))
      return "⚠ Must be JSON. Paste the full {\"type\":\"service_account\",...} object.";
    return null;
  };

  const fields: { key: keyof SettingsState; label: string; desc: string; required?: boolean; multiline?: boolean; placeholder?: string }[] = [
    { key: "anthropic_api_key", label: "Anthropic API Key", desc: "Used for Claude chat, scene translation, and visual interpretation", required: true, placeholder: "sk-ant-..." },
    { key: "openai_api_key", label: "OpenAI API Key", desc: "Used for GPT image generation and GPT-5.4 / GPT-5.5 text analysis / agent", required: true, placeholder: "sk-proj-..." },
    { key: "google_cloud_project_id", label: "Google Cloud Project ID", desc: "Vertex AI — shared for image generation + Gemini text analysis", required: true, placeholder: "my-project-123" },
    { key: "google_service_account_key", label: "Google Service Account Key (JSON)", desc: "Full service-account JSON used to authenticate with Vertex AI", required: true, multiline: true, placeholder: '{"type":"service_account",...}' },
  ];

  // 카드 공통 스타일
  // Cards live inside tab panels now — the panel itself doesn't need
  // an outer max-width because the parent tab container caps it. Keeping
  // the flat / rounded-none brand styling.
  const cardCls = "surface-panel w-full rounded-none p-6 space-y-5";

  // Container width — shared by tab list, tab panels, and action bar so
  // they line up vertically with the same gutter.
  const colCls = "w-full max-w-[520px]";

  // Flat segmented-control look. Active tab gets the brand red underline
  // + bright label; inactive stays muted to match the rest of the page's
  // mono uppercase aesthetic. Matches the same visual language as
  // ContiTab / AgentTab tab strips.
  const tabsListCls =
    "w-full grid grid-cols-2 h-9 p-0 bg-transparent rounded-none border-b border-border-subtle";
  const tabTriggerCls =
    "h-9 rounded-none bg-transparent text-[11px] font-mono font-bold tracking-[0.2em] uppercase " +
    "text-muted-foreground hover:text-text-secondary " +
    "data-[state=active]:bg-transparent data-[state=active]:text-foreground " +
    "data-[state=active]:shadow-none " +
    "data-[state=active]:border-b-2 data-[state=active]:border-primary " +
    "transition-colors";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="app-topbar justify-between px-8">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center pr-8 border-r border-border-subtle hover:opacity-80 transition-opacity"
        >
          <BrandLogo />
        </button>
        <div className="flex items-baseline gap-3 min-w-0 flex-1 px-8">
          <span className="text-[15px] font-bold text-foreground">{t("settings.title")}</span>
          <MetaPill className="h-[20px] px-1.5 text-[9px] tracking-widest">{t("common.localMode")}</MetaPill>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/dashboard")}
            className="h-9 text-[12px] font-bold tracking-wider bg-transparent border-border-subtle text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-transparent gap-1.5 rounded-none"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("common.dashboard")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            className="h-9 min-w-[148px] text-[12px] font-bold tracking-wider rounded-none border-0 gap-1.5 bg-primary hover:bg-primary/85"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                {t("common.saved")}
              </>
            ) : (
              <>
                <Key className="w-3.5 h-3.5" />
                {t("settings.saveSettings")}
              </>
            )}
          </Button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center py-10 px-4 gap-6 overflow-y-auto">

        {/* ── Tabbed body ─────────────────────────────────────────────
              · "API Keys" — provider credentials only (high-frequency
                first-run setup, error path).
              · "Models & Preferences" — model picker + Pro toggle +
                UI lang. These are reviewed less often than keys, so
                grouping them keeps the keys tab short and focused.
            ──────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="keys" className={colCls}>
          <TabsList className={tabsListCls}>
            <TabsTrigger value="keys" className={tabTriggerCls}>{t("settings.apiKeys")}</TabsTrigger>
            <TabsTrigger value="models" className={tabTriggerCls}>{t("settings.modelsPrefs")}</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: API Keys ───────────────────────────────────── */}
          <TabsContent value="keys" className="mt-5 space-y-6">
            <div className={cardCls}>
              <SectionLabel>{t("settings.apiKeys")}</SectionLabel>
              {fields.map(f => {
                const warning = keyWarning(f.key, settings[f.key]);
                return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-text-secondary font-bold tracking-wider uppercase">{f.label}</Label>
                    {f.required && <span className="text-[9px] text-primary font-mono">{t("settings.required")}</span>}
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">{f.desc}</p>
                  {f.multiline ? (
                    <Textarea
                      className={`${inputCls} min-h-[80px] resize-y ${warning ? "border-warning" : ""}`}
                      value={settings[f.key]}
                      onChange={e => setSettings(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <div className="relative">
                      <Input
                        type={showKeys[f.key] ? "text" : "password"}
                        className={`${inputCls} pr-9 ${warning ? "border-warning" : ""}`}
                        value={settings[f.key]}
                        onChange={e => setSettings(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                      />
                      <button
                        type="button"
                        onClick={() => toggle(f.key)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showKeys[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                  {warning && (
                    <p className="text-[10px] font-mono text-warning">{warning}</p>
                  )}
                </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Tab 2: Models & Preferences ──────────────────────── */}
          <TabsContent value="models" className="mt-5 space-y-6">
            <div className={cardCls}>
              <SectionLabel>{t("settings.models")}</SectionLabel>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-secondary font-bold tracking-wider uppercase">{t("settings.briefModel")}</Label>
                <p className="text-[10px] text-muted-foreground font-mono">{t("settings.briefModelDesc")}</p>
                <ModelPicker stage="brief" variant="full" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-secondary font-bold tracking-wider uppercase">{t("settings.agentModel")}</Label>
                <p className="text-[10px] text-muted-foreground font-mono">{t("settings.agentModelDesc")}</p>
                <ModelPicker stage="agent" variant="full" />
              </div>
            </div>

            <div className={cardCls}>
              <SectionLabel>{t("settings.preferences")}</SectionLabel>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-secondary font-bold tracking-wider uppercase">{t("settings.uiLanguage")}</Label>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {t("settings.uiLanguageDesc")}
                </p>
                <Select value={language} onValueChange={(value) => setLanguage(value as UiLanguage)}>
                  <SelectTrigger className={`${inputCls} w-full`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border-subtle text-foreground/80 rounded-none">
                    <SelectItem value="ko" className="font-mono text-[12px]">{t("settings.korean")}</SelectItem>
                    <SelectItem value="en" className="font-mono text-[12px]">{t("settings.english")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-text-secondary font-bold tracking-wider uppercase">
                  {t("settings.dashboardCardsPerRow")}
                </Label>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {t("settings.dashboardCardsPerRowDesc")}
                </p>
                <Select
                  value={String(dashboardCardsPerRow)}
                  onValueChange={handleDashboardCardsPerRowChange}
                >
                  <SelectTrigger className={`${inputCls} w-full`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border-subtle text-foreground/80 rounded-none">
                    {DASHBOARD_CARDS_PER_ROW_OPTIONS.map((value) => (
                      <SelectItem key={value} value={String(value)} className="font-mono text-[12px]">
                        {t("settings.dashboardCardsPerRowOption", { count: String(value) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

      </div>

      <footer className="app-footer justify-between px-5">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{t("common.localMode")}</span>
        <span className="font-mono text-[10px] text-text-tertiary uppercase tracking-wider">Pre-Flow Desktop v1.0</span>
      </footer>
    </div>
  );
};

export default SettingsPage;
