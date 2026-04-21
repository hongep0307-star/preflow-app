// Renderer(브라우저) 와 Electron main 양쪽에서 공유하는 상수.
// 변경 시 한 곳만 고치면 양 빌드에 모두 반영됨.

export const LOCAL_SERVER_PORT = 19876;
export const LOCAL_SERVER_BASE_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}`;
