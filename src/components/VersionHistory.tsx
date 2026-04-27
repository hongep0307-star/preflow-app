import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Save, History, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ModalTitle } from '@/components/common/ui-primitives';

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
  const [pendingRestore, setPendingRestore] = useState<SceneVersion | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

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
        toast({ title: 'No shots to save', variant: 'destructive' });
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

      toast({ title: 'Version saved.' });
      setSaveModalOpen(false);
      setVersionName('');
      await fetchVersions();
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreVersion = (version: SceneVersion) => {
    setPendingRestore(version);
  };

  const confirmRestore = async () => {
    const version = pendingRestore;
    if (!version) return;
    setIsRestoring(true);
    try {
      await supabase.from('scenes').delete().eq('project_id', projectId);

      const scenesToRestore = version.scenes.map(({ id, ...scene }: any) => ({
        ...scene,
        project_id: projectId,
      }));

      await supabase.from('scenes').insert(scenesToRestore);
      onRestore();
      setDrawerOpen(false);
      setPendingRestore(null);
      toast({ title: `Restored to "${version.version_name}".` });
    } catch (err: any) {
      toast({ title: 'Restore failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsRestoring(false);
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
    pendingRestore,
    setPendingRestore,
    confirmRestore,
    isRestoring,
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
        <DialogTitle asChild>
          <ModalTitle>Save current version</ModalTitle>
        </DialogTitle>
      </DialogHeader>
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Version name</label>
        <Input
          value={versionName}
          onChange={e => setVersionName(e.target.value)}
          placeholder="Version name"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" className="text-[13px] h-9" onClick={onClose}>Cancel</Button>
        <Button className="text-[13px] h-9" onClick={onSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/* ── Version Restore Confirm Dialog ── */
export const VersionRestoreConfirm = ({
  pendingRestore,
  onOpenChange,
  onConfirm,
  isRestoring,
}: {
  pendingRestore: SceneVersion | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isRestoring: boolean;
}) => (
  <AlertDialog open={!!pendingRestore} onOpenChange={(o) => !isRestoring && onOpenChange(o)}>
    <AlertDialogContent
      className="max-w-[420px] bg-card border-border"
      style={{ borderRadius: 0 }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle asChild>
          <ModalTitle help="Save the current state first if you may need to come back to it.">
            Restore to "{pendingRestore?.version_name ?? `v${pendingRestore?.version_number}`}"?
          </ModalTitle>
        </AlertDialogTitle>
        <AlertDialogDescription className="text-[13px] text-muted-foreground leading-relaxed">
          This replaces the current scene list.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="text-[13px] h-9" disabled={isRestoring}>
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction
          className="bg-primary text-white text-[13px] h-9 hover:bg-primary/85"
          disabled={isRestoring}
          onClick={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          {isRestoring ? 'Restoring…' : 'Restore'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
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
      <Save className="w-4 h-4" />Save version
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
          <span className="text-base font-semibold text-foreground">Version history</span>
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
                    {new Date(version.created_at).toLocaleString()} · {(version.scenes as any[]).length} scene{(version.scenes as any[]).length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  onClick={() => onRestore(version)}
                  className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-none border border-primary/30 bg-primary/10 text-primary transition-colors hover:bg-primary/15"
                >
                  <RotateCcw className="w-3 h-3" />Restore
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
                      <img src={scene.conti_image_url} className="w-full h-full object-cover" loading="lazy" decoding="async" />
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
            <EmptyState
              icon={<History className="w-8 h-8" />}
              title="No saved versions yet."
              description="Use the Save version button to snapshot the current state."
              compact
            />
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
