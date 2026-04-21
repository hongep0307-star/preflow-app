import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, ArrowLeft, Check, Key } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LOCAL_SERVER_BASE_URL } from "@shared/constants";

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
    setSaved(true);
    setLoading(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggle = (key: string) => setShowKeys(p => ({ ...p, [key]: !p[key] }));

  const inputCls =
    "h-9 bg-white/[0.05] border-white/[0.12] text-[12px] text-white/80 placeholder:text-white/25 focus-visible:ring-0 focus-visible:border-white/25 rounded-none font-mono";

  const keyWarning = (key: keyof SettingsState, value: string): string | null => {
    if (!value || value.length < 5) return null;
    if (key === "openai_api_key" && value.startsWith("sk-ant-"))
      return "⚠ 이 키는 Anthropic 키 형식입니다. OpenAI 키(sk-proj-... 또는 sk-...)를 입력하세요.";
    if (key === "anthropic_api_key" && (value.startsWith("sk-proj-") || (value.startsWith("sk-") && !value.startsWith("sk-ant-"))))
      return "⚠ 이 키는 OpenAI 키 형식입니다. Anthropic 키(sk-ant-...)를 입력하세요.";
    if (key === "google_service_account_key" && !value.trim().startsWith("{"))
      return "⚠ JSON 형식이어야 합니다. {\"type\":\"service_account\",...} 형태로 입력하세요.";
    return null;
  };

  const fields: { key: keyof SettingsState; label: string; desc: string; required?: boolean; multiline?: boolean; placeholder?: string }[] = [
    { key: "anthropic_api_key", label: "Anthropic API Key", desc: "Claude 채팅, 씬 번역, 시각 해석에 사용", required: true, placeholder: "sk-ant-..." },
    { key: "openai_api_key", label: "OpenAI API Key", desc: "GPT 이미지 생성 (NB2 폴백)에 사용", required: true, placeholder: "sk-proj-..." },
    { key: "google_cloud_project_id", label: "Google Cloud Project ID", desc: "Vertex AI — 이미지 생성 + Gemini 텍스트 분석 통합 사용", required: true, placeholder: "my-project-123" },
    { key: "google_service_account_key", label: "Google Service Account Key (JSON)", desc: "Vertex AI 인증용 서비스 계정 키 전체 JSON", required: true, multiline: true, placeholder: '{"type":"service_account",...}' },
  ];

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <div className="flex-1 flex flex-col items-center py-12 px-4 gap-8 overflow-y-auto">
        <div className="flex flex-col items-center gap-4">
          <FilmIconHero />
          <div className="text-center">
            <div className="text-[32px] font-extrabold tracking-tight leading-none select-none">
              <span className="text-white">Pre</span>
              <span style={{ color: KR }}>-Flow</span>
            </div>
            <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-white/25 uppercase">
              API Key Settings
            </p>
          </div>
        </div>

        <div className="w-full max-w-[520px] bg-white/[0.04] border border-white/[0.1] rounded-none p-6 space-y-5">
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

          <div className="flex gap-3 pt-2">
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
