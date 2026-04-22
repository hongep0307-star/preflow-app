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
  // 모든 project-scoped 버킷을 purge. `mood` 누락으로 9장짜리 mood 배치가
  // 프로젝트 삭제 후에도 디스크에 남아 계속 쌓이던 누수를 차단.
  //
  // NOTE: `style-presets` 버킷은 user-scoped (style_presets 테이블에
  //       project_id 컬럼이 없음) 이라 여기서 purge 하지 않는다 —
  //       여러 프로젝트가 같은 프리셋을 공유하기 때문.
  await Promise.all([
    purgeStorageFolder("contis", projectId),
    purgeStorageFolder("assets", projectId),
    purgeStorageFolder("briefs", projectId),
    purgeStorageFolder("mood", projectId),
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
