import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Save, History, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

interface SceneVersion {
  id: string;
  project_id: string;
  version_number: number;
  version_name: string | null;
  scenes: any[];
  created_at: string;
}

interface Props {
  projectId: string;
  onRestore: () => void;
}

export const useVersionHistory = ({ projectId, onRestore }: Props) => {
  const { toast } = useToast();
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [versions, setVersions] = useState<SceneVersion[]>([]);

  const fetchVersions = useCallback(async () => {
    const { data } = await supabase
      .from('scene_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (data) setVersions(data as SceneVersion[]);
  }, [projectId]);

  const handleSaveVersion = async () => {
    setIsSaving(true);
    try {
      const { data: currentScenes } = await supabase
        .from('scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('scene_number');

      if (!currentScenes || currentScenes.length === 0) {
        toast({ title: '저장할 씬이 없습니다', variant: 'destructive' });
        return;
      }

      const { data: versionCount } = await supabase
        .from('scene_versions')
        .select('id')
        .eq('project_id', projectId);

      const num = (versionCount?.length ?? 0) + 1;

      await supabase.from('scene_versions').insert({
        project_id: projectId,
        version_number: num,
        version_name: versionName.trim() || `v${num}`,
        scenes: currentScenes,
      });

      toast({ title: '버전이 저장됐습니다!' });
      setSaveModalOpen(false);
      setVersionName('');
      await fetchVersions();
    } catch (err: any) {
      toast({ title: '버전 저장 실패', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreVersion = async (version: SceneVersion) => {
    const confirmed = window.confirm(
      `"${version.version_name}"으로 복원하시겠어요?\n현재 씬 목록이 이 버전으로 교체됩니다.\n(복원 전에 현재 버전을 저장해두는 것을 권장합니다)`
    );
    if (!confirmed) return;

    try {
      await supabase.from('scenes').delete().eq('project_id', projectId);

      const scenesToRestore = version.scenes.map(({ id, ...scene }: any) => ({
        ...scene,
        project_id: projectId,
      }));

      await supabase.from('scenes').insert(scenesToRestore);
      onRestore();
      setDrawerOpen(false);
      toast({ title: `"${version.version_name}"으로 복원됐습니다.` });
    } catch (err: any) {
      toast({ title: '복원 실패', description: err.message, variant: 'destructive' });
    }
  };

  useEffect(() => {
    if (drawerOpen) fetchVersions();
  }, [drawerOpen, fetchVersions]);

  return {
    saveModalOpen,
    setSaveModalOpen,
    drawerOpen,
    setDrawerOpen,
    versionName,
    setVersionName,
    isSaving,
    versions,
    handleSaveVersion,
    handleRestoreVersion,
  };
};

/* ── Version Save Modal ── */
export const VersionSaveModal = ({
  open, onClose, versionName, setVersionName, onSave, isSaving,
}: {
  open: boolean;
  onClose: () => void;
  versionName: string;
  setVersionName: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
}) => (
  <Dialog open={open} onOpenChange={o => !o && onClose()}>
    <DialogContent className="max-w-[400px] bg-card border-border">
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold">현재 버전 저장</DialogTitle>
      </DialogHeader>
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">버전 이름</label>
        <Input
          value={versionName}
          onChange={e => setVersionName(e.target.value)}
          placeholder="Version name"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>취소</Button>
        <Button className="text-[13px] h-9" onClick={onSave} disabled={isSaving}>
          {isSaving ? '저장 중...' : '저장'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/* ── Version Save & History Buttons ── */
export const VersionButtons = ({
  onSave, onHistory,
}: {
  onSave: () => void;
  onHistory: () => void;
}) => (
  <>
    <Button variant="ghost" size="sm" onClick={onSave} className="gap-1 text-muted-foreground">
      <Save className="w-4 h-4" />버전 저장
    </Button>
    <Button variant="ghost" size="sm" onClick={onHistory} className="gap-1 text-muted-foreground">
      <History className="w-4 h-4" />
    </Button>
  </>
);

/* ── Version History Drawer ── */
export const VersionHistoryDrawer = ({
  open, onClose, versions, onRestore,
}: {
  open: boolean;
  onClose: () => void;
  versions: SceneVersion[];
  onRestore: (v: SceneVersion) => void;
}) => {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[360px] bg-card border-l border-border flex flex-col"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-base font-semibold text-foreground">버전 히스토리</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {versions.map(version => (
            <div key={version.id} className="bg-background border border-border rounded p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {version.version_name || `v${version.version_number}`}
                  </div>
                  <div className="text-[11px] text-muted-foreground/50 mt-0.5">
                    {new Date(version.created_at).toLocaleString('ko-KR')} · 씬 {(version.scenes as any[]).length}개
                  </div>
                </div>
                <button
                  onClick={() => onRestore(version)}
                  className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md border transition-colors"
                  style={{ color: '#f9423a', background: 'rgba(249,66,58,0.10)', borderColor: 'rgba(249,66,58,0.28)' }}
                >
                  <RotateCcw className="w-3 h-3" />복원
                </button>
              </div>

              {/* Scene thumbnails strip */}
              <div className="flex gap-1.5 mt-3 overflow-x-auto">
                {(version.scenes as any[]).slice(0, 6).map((scene: any, i: number) => (
                  <div
                    key={scene.id || i}
                    className="shrink-0 w-[52px] h-[36px] rounded border border-border overflow-hidden bg-background"
                  >
                    {scene.conti_image_url ? (
                      <img src={scene.conti_image_url} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] text-muted-foreground/30">
                        S{scene.scene_number}
                      </div>
                    )}
                  </div>
                ))}
                {(version.scenes as any[]).length > 6 && (
                  <div className="shrink-0 w-[52px] h-[36px] rounded bg-background flex items-center justify-center text-[10px] text-muted-foreground/40">
                    +{(version.scenes as any[]).length - 6}
                  </div>
                )}
              </div>
            </div>
          ))}

          {versions.length === 0 && (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground/40">저장된 버전이 없습니다.</p>
              <p className="text-xs text-muted-foreground/30 mt-1">"버전 저장" 버튼으로 현재 상태를 저장하세요.</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
};
