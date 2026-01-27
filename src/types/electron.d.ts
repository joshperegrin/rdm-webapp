export {};

declare global {
  interface Window {
    electronAPI: {
      getLocation: () => Promise<{
        lat: number;
        lng: number;
        accuracy?: number;
      }>;
    };
  }
}

declare global {
  interface Window {
    db: {
      getSessions: () => Promise<Session[]>;
      getRoadDefects: (sessionId: string) => Promise<any[]>;
    };
  }
}