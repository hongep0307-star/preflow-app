import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Clock, Send, Loader2, RotateCcw, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { KR, type Scene } from "./agentTypes";

/* ━━━━━ ConfirmScenesModal ━━━━━ */
export const ConfirmScenesModal = ({ pendingCount, existingCount, onClose, onConfirm }: {
  pendingCount: number; existingCount: number; onClose: () => void; onConfirm: (mode: "replace" | "append") => void;
}) => (
  <Dialog open onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-w-[400px] bg-card border-border">
      <DialogHeader><DialogTitle>CREATE SCENE CARDS</DialogTitle></DialogHeader>
      <p className="text-[13px] text-muted-foreground">You have {existingCount} existing scenes. How would you like to add the {pendingCount} draft scenes?</p>
      <div className="space-y-2 mt-1">
        {[
          { mode: "replace" as const, Icon: RotateCcw, title: `Replace existing (start fresh with ${pendingCount})`, desc: "Delete all existing scenes and replace with draft" },
          { mode: "append" as const, Icon: Plus, title: `Append to existing (${existingCount + pendingCount} total)`, desc: "Append draft scenes after existing ones" },
        ].map((opt) => (
          <button key={opt.mode} onClick={() => { onConfirm(opt.mode); onClose(); }} className="w-full flex items-start gap-3 p-3 rounded-none border text-left transition-colors hover:border-[#f9423a] hover:bg-[rgba(249,66,58,0.04)]" style={{ borderColor: "hsl(var(--border))", background: "transparent" }}>
            <opt.Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "rgba(255,255,255,0.5)" }} strokeWidth={1.75} />
            <div><div className="text-[13px] font-semibold text-foreground">{opt.title}</div><div className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</div></div>
          </button>
        ))}
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>CANCEL</Button></DialogFooter>
    </DialogContent>
  </Dialog>
);

/* ━━━━━ SendToContiModal ━━━━━ */
export const SendToContiModal = ({ scenes, projectId, onClose, onSent }: {
  scenes: Scene[]; projectId: string; onClose: () => void; onSent: (id: string, name: string) => void;
}) => {
  const { toast } = useToast();
  const [versionName, setVersionName] = useState("");
  const [isSending, setIsSending] = useState(false);
  const handleSend = async () => {
    if (!scenes.length) { toast({ title: "No scenes to send", variant: "destructive" }); return; }
    setIsSending(true);
    try {
      const { data: existing } = await supabase.from("scene_versions").select("id").eq("project_id", projectId);
      const num = (existing?.length ?? 0) + 1;
      const name = versionName.trim() || `ver.${num}`;
      const { data: newVer, error } = await supabase.from("scene_versions").insert({ project_id: projectId, version_number: num, version_name: name, display_order: num, scenes: scenes as any, is_active: true }).select().single();
      if (error || !newVer) throw new Error(error?.message ?? "Version creation failed");
      await supabase.from("projects").update({ active_version_id: newVer.id }).eq("id", projectId);
      toast({ title: `"${name}" sent to Conti tab` });
      onSent(newVer.id, name);
      onClose();
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally { setIsSending(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[420px] bg-card border-border">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Send className="w-4 h-4" style={{ color: KR }} />Send to Conti</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-none border border-border bg-background p-3 space-y-1">
            <div className="text-[12px] text-muted-foreground mb-1.5">Scenes to send ({scenes.length})</div>
            {scenes.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[13px]">
                <span className="text-muted-foreground/50 w-5 shrink-0 text-right">#{s.scene_number}</span>
                <span className="text-foreground truncate">{s.title || `S${String(s.scene_number).padStart(2, "0")}`}</span>
                {s.duration_sec && <span className="ml-auto text-[11px] text-muted-foreground/60 shrink-0 flex items-center gap-1"><Clock className="w-3 h-3" />{s.duration_sec}s</span>}
              </div>
            ))}
            {scenes.some((s) => s.duration_sec) && <div className="pt-1.5 mt-1.5 border-t border-border/50 text-[11px] text-muted-foreground/60 flex items-center gap-1"><Clock className="w-3 h-3" />Total {scenes.reduce((acc, s) => acc + (s.duration_sec ?? 0), 0)}s</div>}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Version Name</label>
            <Input value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="Auto-generated if empty" autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={isSending} className="gap-1.5">
            {isSending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Sending...</> : <><Send className="w-3.5 h-3.5" />Send to Conti</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ━━━━━ LoadVersionModal ━━━━━ */
export const LoadVersionModal = ({ versions, onClose, onLoad }: {
  versions: { id: string; version_name: string | null; version_number: number; scenes: any[] }[];
  onClose: () => void; onLoad: (scenes: any[]) => Promise<void>;
}) => {
  const [loading, setLoading] = useState(false);
  if (!versions.length) return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[360px] bg-card border-border">
        <DialogHeader><DialogTitle className="text-[15px] font-semibold">Load conti version</DialogTitle></DialogHeader>
        <p className="text-[13px] text-muted-foreground">No saved conti versions yet.<br />Create a conti draft in the Conti tab first.</p>
        <DialogFooter><Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[440px] bg-card border-border">
        <DialogHeader><DialogTitle className="text-[15px] font-semibold flex items-center gap-2"><RotateCcw className="w-4 h-4" style={{ color: KR }} />Load conti version</DialogTitle></DialogHeader>
        <p className="text-[12px] text-muted-foreground -mt-1">Loading will replace the current scene composition with the selected version.</p>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {versions.map((v, idx) => (
            <button key={v.id} disabled={loading} onClick={async () => { setLoading(true); await onLoad(v.scenes.filter((s: any) => s.is_transition !== true && !s.transition_type)); setLoading(false); onClose(); }} className="w-full flex items-center gap-3 p-3 rounded-none border text-left transition-colors hover:border-[#f9423a] hover:bg-[rgba(249,66,58,0.04)] disabled:opacity-50" style={{ borderColor: "hsl(var(--border))", background: "transparent" }}>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-none text-white shrink-0" style={{ background: KR }}>{`ver.${idx + 1}`}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-foreground truncate">{v.version_name || `v${v.version_number}`}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{v.scenes.length} scenes{v.scenes.some((s: any) => s.duration_sec) && <> · Total {v.scenes.reduce((a: number, s: any) => a + (s.duration_sec ?? 0), 0)}s</>}</div>
              </div>
              <div className="flex flex-col gap-0.5 shrink-0 max-w-[120px]">
                {v.scenes.slice(0, 3).map((s: any, i: number) => <span key={i} className="text-[10px] text-muted-foreground/60 truncate">{i + 1}. {s.title || `Scene ${i + 1}`}</span>)}
                {v.scenes.length > 3 && <span className="text-[10px] text-muted-foreground/40">+{v.scenes.length - 3} more</span>}
              </div>
              {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0 ml-1" style={{ color: KR }} /> : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 ml-1"><path d="M9 18l6-6-6-6" /></svg>}
            </button>
          ))}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
