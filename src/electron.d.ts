interface ElectronAPI {
  db: {
    query: (sql: string, params?: any[]) => Promise<any>;
    run: (sql: string, params?: any[]) => Promise<any>;
    get: (sql: string, params?: any[]) => Promise<any>;
    all: (sql: string, params?: any[]) => Promise<any[]>;
    select: (table: string, where?: Record<string, any>, options?: any) => Promise<any[]>;
    insert: (table: string, data: Record<string, any>) => Promise<any>;
    update: (table: string, data: Record<string, any>, where: Record<string, any>) => Promise<any[]>;
    delete: (table: string, where: Record<string, any>) => Promise<any>;
    upsert: (table: string, data: Record<string, any>, conflictKeys: string[]) => Promise<any>;
  };
  storage: {
    upload: (bucket: string, filePath: string, data: ArrayBuffer, contentType?: string) => Promise<{ error: any }>;
    getPublicUrl: (bucket: string, filePath: string) => Promise<{ data: { publicUrl: string } }>;
    remove: (bucket: string, filePaths: string[]) => Promise<{ error: any }>;
    list: (bucket: string, folder: string, options?: any) => Promise<{ data: { name: string }[]; error: any }>;
  };
  api: {
    claudeProxy: (body: any) => Promise<any>;
    openaiImage: (body: any) => Promise<any>;
    analyzeBrief: (body: any) => Promise<any>;
    enhanceInpaintPrompt: (body: any) => Promise<any>;
    translateAnalysis: (body: any) => Promise<any>;
    analyzeReferenceImages: (body: any) => Promise<any>;
  };
  settings: {
    get: () => Promise<any>;
    set: (settings: any) => Promise<any>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
