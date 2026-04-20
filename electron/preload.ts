const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  db: {
    query: (sql: string, params?: any[]) => ipcRenderer.invoke("db:query", sql, params),
    run: (sql: string, params?: any[]) => ipcRenderer.invoke("db:run", sql, params),
    get: (sql: string, params?: any[]) => ipcRenderer.invoke("db:get", sql, params),
    all: (sql: string, params?: any[]) => ipcRenderer.invoke("db:all", sql, params),
    select: (table: string, where?: Record<string, any>, options?: any) =>
      ipcRenderer.invoke("db:select", table, where, options),
    insert: (table: string, data: Record<string, any>) =>
      ipcRenderer.invoke("db:insert", table, data),
    update: (table: string, data: Record<string, any>, where: Record<string, any>) =>
      ipcRenderer.invoke("db:update", table, data, where),
    delete: (table: string, where: Record<string, any>) =>
      ipcRenderer.invoke("db:delete", table, where),
    upsert: (table: string, data: Record<string, any>, conflictKeys: string[]) =>
      ipcRenderer.invoke("db:upsert", table, data, conflictKeys),
  },
  storage: {
    upload: (bucket: string, filePath: string, data: ArrayBuffer, contentType?: string) =>
      ipcRenderer.invoke("storage:upload", bucket, filePath, data, contentType),
    getPublicUrl: (bucket: string, filePath: string) =>
      ipcRenderer.invoke("storage:getPublicUrl", bucket, filePath),
    remove: (bucket: string, filePaths: string[]) =>
      ipcRenderer.invoke("storage:remove", bucket, filePaths),
    list: (bucket: string, folder: string, options?: any) =>
      ipcRenderer.invoke("storage:list", bucket, folder, options),
  },
  api: {
    claudeProxy: (body: any) => ipcRenderer.invoke("api:claude-proxy", body),
    openaiImage: (body: any) => ipcRenderer.invoke("api:openai-image", body),
    analyzeBrief: (body: any) => ipcRenderer.invoke("api:analyze-brief", body),
    enhanceInpaintPrompt: (body: any) => ipcRenderer.invoke("api:enhance-inpaint-prompt", body),
    translateAnalysis: (body: any) => ipcRenderer.invoke("api:translate-analysis", body),
    analyzeReferenceImages: (body: any) => ipcRenderer.invoke("api:analyze-reference-images", body),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (settings: any) => ipcRenderer.invoke("settings:set", settings),
  },
});
