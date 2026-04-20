import { supabase } from "./supabase";

const LS_HISTORY_PREFIX = "ff_history_";

/* Storage 버킷 폴더 완전 삭제 */
const purgeStorageFolder = async (bucket: string, folder: string) => {
  let offset = 0;
  while (true) {
    const { data: files, error } = await supabase.storage.from(bucket).list(folder, { limit: 100, offset });

    if (error || !files || files.length === 0) break;

    const paths = files.map((f) => `${folder}/${f.name}`);
    await supabase.storage.from(bucket).remove(paths);

    if (files.length < 100) break;
    offset += 100;
  }
};

export const deleteProjectCompletely = async (projectId: string): Promise<void> => {
  // ── 1. Storage 파일 삭제 ─────────────────────────────────────────
  await Promise.all([
    purgeStorageFolder("contis", projectId),
    purgeStorageFolder("assets", projectId),
    purgeStorageFolder("briefs", projectId),
  ]);

  // ── 2. DB 레코드 삭제 (참조 순서 준수) ──────────────────────────
  await supabase.from("chat_logs").delete().eq("project_id", projectId);
  await supabase.from("scene_versions").delete().eq("project_id", projectId);
  await supabase.from("scenes").delete().eq("project_id", projectId);
  await supabase.from("assets").delete().eq("project_id", projectId);
  await supabase.from("briefs").delete().eq("project_id", projectId);
  await supabase.from("projects").delete().eq("id", projectId);

  // ── 3. localStorage 완전 정리 ────────────────────────────────────
  const keys = [
    `${LS_HISTORY_PREFIX}${projectId}`, // ContiTab  씬 이미지 히스토리
    `ff_brief_draft_${projectId}`, // BriefTab  브리프 입력 내용
    `ff_focal_${projectId}`, // AssetsTab 얼굴 위치/줌
    `ff_pending_scenes_${projectId}`, // AgentTab  초안 씬
    `preflow_onboarding_${projectId}`, // ProjectPage 온보딩 닫음 여부
  ];
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  });
};
