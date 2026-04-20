import { useEffect, useCallback, useState } from 'react';
import { X, ChevronLeft, ChevronRight, RefreshCw, Download, Paintbrush, Loader2 } from 'lucide-react';

interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  title: string | null;
  description: string | null;
  camera_angle: string | null;
  location: string | null;
  mood: string | null;
  tagged_assets: string[];
  duration_sec: number | null;
  conti_image_url: string | null;
}

interface Props {
  scene: Scene;
  allScenes: Scene[];
  onClose: () => void;
  onRegenerate: (scene: Scene) => void;
  onInpaint: (scene: Scene) => void;
  isRegenerating?: boolean;
}

export const ContiLightbox = ({ scene, allScenes, onClose, onRegenerate, onInpaint, isRegenerating }: Props) => {
  const [currentIndex, setCurrentIndex] = useState(() =>
    allScenes.findIndex(s => s.id === scene.id)
  );

  const currentScene = allScenes[currentIndex] ?? scene;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allScenes.length - 1;

  const goToPrev = useCallback(() => {
    if (hasPrev) setCurrentIndex(i => i - 1);
  }, [hasPrev]);

  const goToNext = useCallback(() => {
    if (hasNext) setCurrentIndex(i => i + 1);
  }, [hasNext]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, goToPrev, goToNext]);

  const handleDownload = () => {
    if (!currentScene.conti_image_url) return;
    const a = document.createElement('a');
    a.href = currentScene.conti_image_url;
    a.download = `scene-${currentScene.scene_number}.png`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 h-14 flex items-center justify-between px-6 border-b border-border"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-foreground font-semibold text-sm">
          Scene {currentScene.scene_number} — {currentScene.title || `Scene ${currentScene.scene_number}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRegenerate(currentScene)}
            disabled={isRegenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40"
          >
            {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            재생성
          </button>
          <button
            onClick={() => onInpaint(currentScene)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Paintbrush className="w-3.5 h-3.5" />
            브러시 편집
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            다운로드
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Prev / Next */}
      {hasPrev && (
        <button
          className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-secondary/80 flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
          onClick={e => { e.stopPropagation(); goToPrev(); }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {hasNext && (
        <button
          className="absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-secondary/80 flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
          onClick={e => { e.stopPropagation(); goToNext(); }}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Main image */}
      {currentScene.conti_image_url ? (
        <img
          src={currentScene.conti_image_url}
          className="rounded-lg"
          style={{ maxHeight: 'calc(100vh - 140px)', maxWidth: '90vw', objectFit: 'contain' }}
          onClick={e => e.stopPropagation()}
          alt={`Scene ${currentScene.scene_number}`}
        />
      ) : (
        <div className="text-muted-foreground text-sm" onClick={e => e.stopPropagation()}>콘티 이미지 없음</div>
      )}

      {/* Bottom info */}
      <div
        className="absolute bottom-0 left-0 right-0 px-6 py-3 flex items-center gap-6"
        style={{ background: 'rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}
      >
        {currentScene.camera_angle && <span className="text-xs text-muted-foreground">{currentScene.camera_angle}</span>}
        {currentScene.location && <span className="text-xs text-muted-foreground">{currentScene.location}</span>}
        {currentScene.mood && <span className="text-xs text-muted-foreground">{currentScene.mood}</span>}
        {currentScene.duration_sec && <span className="text-xs text-muted-foreground">{currentScene.duration_sec}초</span>}
      </div>
    </div>
  );
};
