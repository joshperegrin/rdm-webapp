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
