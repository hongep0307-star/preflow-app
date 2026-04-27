import { useState, useEffect, useCallback } from "react";
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
import { LOCAL_SERVER_BASE_URL } from "@shared/constants";
import ModelPicker from "@/components/common/ModelPicker";
import { invalidateSettingsCache } from "@/lib/settingsCache";

const settingsApi = {
  get: async () => {
    const res = await fetch(`${LOCAL_SERVER_BASE_URL}/settings/get`, { method: "POST" });
    return res.json();
  },
  set: async (s: any) => {
    const res = await fetch(`${LOCAL_SERVER_BASE_URL}/settings/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    return res.json();
  },
};

const KR = "#f9423a";

const FilmIconHero = () => (
  <div className="relative w-12 h-[38px] mx-auto">
    <div className="absolute bottom-0 right-0 w-[30px] h-[22px] rounded-[3px] border-2 border-white/10 bg-[#1a1a1a]" />
    <div className="absolute bottom-[5px] right-[5px] w-[32px] h-[24px] rounded-[3px] border-2 border-[#5a2a2a] bg-[#1c1010]" />
    <div className="absolute bottom-[10px] right-[9px] w-[34px] h-[26px] rounded-[3px] border-2 border-[#f9423a] bg-[#1f0f0f]">
      <span className="absolute left-[3px] top-[28%] w-[4px] h-[4px] bg-[#f9423a] rounded-[1px]" />
      <span className="absolute left-[3px] top-[58%] w-[4px] h-[4px] bg-[#f9423a] rounded-[1px]" />
      <span className="absolute right-[3px] top-[28%] w-[4px] h-[4px] bg-[#f9423a] rounded-[1px]" />
      <span className="absolute right-[3px] top-[58%] w-[4px] h-[4px] bg-[#f9423a] rounded-[1px]" />
    </div>
  </div>
);

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

const UI_LANG_KEY = "ff_ui_lang";

const SettingsPage = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SettingsState>({
    anthropic_api_key: "",
    openai_api_key: "",
    google_service_account_key: "",
    google_cloud_project_id: "",
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uiLang, setUiLang] = useState<string>(() => {
    if (typeof window === "undefined") return "ko";
    return window.localStorage.getItem(UI_LANG_KEY) ?? "ko";
  });

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

  const handleUiLangChange = useCallback((value: string) => {
    setUiLang(value);
    try {
      window.localStorage.setItem(UI_LANG_KEY, value);
    } catch {
      /* ignore */
    }
  }, []);

  const inputCls =
    "h-9 bg-white/[0.05] border-white/[0.12] text-[12px] text-white/80 placeholder:text-white/25 focus-visible:ring-0 focus-visible:border-white/25 rounded-none font-mono";

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
  const cardCls = "w-full bg-white/[0.04] border border-white/[0.1] rounded-none p-6 space-y-5";
  const sectionLabelCls = "text-[10px] font-mono uppercase tracking-[0.2em] text-white/35 mb-3 block";

  // Container width — shared by tab list, tab panels, and action bar so
  // they line up vertically with the same gutter.
  const colCls = "w-full max-w-[520px]";

  // Flat segmented-control look. Active tab gets the brand red underline
  // + bright label; inactive stays muted to match the rest of the page's
  // mono uppercase aesthetic. Matches the same visual language as
  // ContiTab / AgentTab tab strips.
  const tabsListCls =
    "w-full grid grid-cols-2 h-9 p-0 bg-transparent rounded-none border-b border-white/[0.08]";
  const tabTriggerCls =
    "h-9 rounded-none bg-transparent text-[11px] font-mono font-bold tracking-[0.2em] uppercase " +
    "text-white/35 hover:text-white/60 " +
    "data-[state=active]:bg-transparent data-[state=active]:text-white " +
    "data-[state=active]:shadow-none " +
    "data-[state=active]:border-b-2 data-[state=active]:border-[#f9423a] " +
    "transition-colors";

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <div className="flex-1 flex flex-col items-center py-12 px-4 gap-6 overflow-y-auto">
        <div className="flex flex-col items-center gap-4">
          <FilmIconHero />
          <div className="text-center">
            <div className="text-[32px] font-extrabold tracking-tight leading-none select-none">
              <span className="text-white">Pre</span>
              <span style={{ color: KR }}>-Flow</span>
            </div>
            <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase">
              Settings
            </p>
          </div>
        </div>

        {/* ── Tabbed body ─────────────────────────────────────────────
              · "API Keys" — provider credentials only (high-frequency
                first-run setup, error path).
              · "Models & Preferences" — model picker + Pro toggle +
                UI lang. These are reviewed less often than keys, so
                grouping them keeps the keys tab short and focused.
            ──────────────────────────────────────────────────────────── */}
        <Tabs defaultValue="keys" className={colCls}>
          <TabsList className={tabsListCls}>
            <TabsTrigger value="keys" className={tabTriggerCls}>API Keys</TabsTrigger>
            <TabsTrigger value="models" className={tabTriggerCls}>Models &amp; Preferences</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: API Keys ───────────────────────────────────── */}
          <TabsContent value="keys" className="mt-5 space-y-6">
            <div className={cardCls}>
              <span className={sectionLabelCls}>API Keys</span>
              {fields.map(f => {
                const warning = keyWarning(f.key, settings[f.key]);
                return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-white/60 font-bold tracking-wider uppercase">{f.label}</Label>
                    {f.required && <span className="text-[9px] text-[#f9423a] font-mono">REQUIRED</span>}
                  </div>
                  <p className="text-[10px] text-white/25 font-mono">{f.desc}</p>
                  {f.multiline ? (
                    <Textarea
                      className={`${inputCls} min-h-[80px] resize-y`}
                      style={warning ? { borderColor: "#f59e0b" } : undefined}
                      value={settings[f.key]}
                      onChange={e => setSettings(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <div className="relative">
                      <Input
                        type={showKeys[f.key] ? "text" : "password"}
                        className={`${inputCls} pr-9`}
                        style={warning ? { borderColor: "#f59e0b" } : undefined}
                        value={settings[f.key]}
                        onChange={e => setSettings(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                      />
                      <button
                        type="button"
                        onClick={() => toggle(f.key)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors"
                      >
                        {showKeys[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                  {warning && (
                    <p className="text-[10px] font-mono" style={{ color: "#f59e0b" }}>{warning}</p>
                  )}
                </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Tab 2: Models & Preferences ──────────────────────── */}
          <TabsContent value="models" className="mt-5 space-y-6">
            <div className={cardCls}>
              <span className={sectionLabelCls}>Models</span>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-white/60 font-bold tracking-wider uppercase">Brief Analysis Model</Label>
                <p className="text-[10px] text-white/25 font-mono">Model used to analyze brief text + images/video. Takes effect from the next analysis.</p>
                <ModelPicker stage="brief" variant="full" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-white/60 font-bold tracking-wider uppercase">Agent Chat Model</Label>
                <p className="text-[10px] text-white/25 font-mono">Model used in agent chat (storylines / storyboard). Takes effect from your next message.</p>
                <ModelPicker stage="agent" variant="full" />
              </div>
            </div>

            <div className={cardCls}>
              <span className={sectionLabelCls}>Preferences</span>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-white/60 font-bold tracking-wider uppercase">UI Language</Label>
                <p className="text-[10px] text-white/25 font-mono">
                  This controls the app UI language, not the agent/brief analysis output (analysis language is chosen via the KO/EN toggle in the Brief tab).
                  <br />
                  <span className="text-amber-400/70">Coming soon — full UI translation ships in a later update.</span>
                </p>
                <Select value={uiLang} onValueChange={handleUiLangChange}>
                  <SelectTrigger className={`${inputCls} w-full`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#161616] border-white/10 text-white/80 rounded-none">
                    <SelectItem value="ko" className="font-mono text-[12px]">한국어 (KO)</SelectItem>
                    <SelectItem value="en" className="font-mono text-[12px]">English (EN)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Action bar ──────────────────────────────────────────── */}
        <div className="w-full max-w-[520px] flex gap-3">
          <Button
            variant="outline"
            onClick={() => navigate("/dashboard")}
            className="h-9 text-[12px] font-bold tracking-wider bg-transparent border-white/[0.1] text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-transparent gap-1.5 rounded-none"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 h-9 text-[12px] font-bold tracking-wider rounded-none border-0 gap-1.5"
            style={{ background: KR }}
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Saved
              </>
            ) : (
              <>
                <Key className="w-3.5 h-3.5" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>

      <footer
        className="flex items-center justify-between px-5 border-t border-white/[0.06] flex-shrink-0"
        style={{ height: 28, background: "#060606" }}
      >
        <span className="font-mono text-[10px] text-white/40 uppercase tracking-wider">Local Mode</span>
        <span className="font-mono text-[10px] text-white/20 uppercase tracking-wider">Pre-Flow Desktop v1.0</span>
      </footer>
    </div>
  );
};

export default SettingsPage;
