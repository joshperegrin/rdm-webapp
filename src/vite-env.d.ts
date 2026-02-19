/// <reference types="vite-plugin-svgr/client" />
/// <reference types="vite/client" />
import { DatabaseAPI, RaspConnectionAPI } from './preload';
declare global {
  interface Window {
    database: DatabaseAPI;
    rasp_connection: RaspConnectionAPI;
  }
}

export interface DatabaseAPI {
  getSessions: () => Promise<any[]>;
  getRoadDefectsBySession: (sessionId: number) => Promise<any[]>;
  markFixed: (id: number) => Promise<void>;
  archive: (id: number) => Promise<void>;
}

export interface RaspConnectionAPI {
  connect_client: (rasp_ip: string, rasp_port: number) => Promise<void>;
  send_startreq: () => Promise<void>;
  send_stopreq: () => Promise<void>;
  onPreviewFrame: (callback: (buffer: Uint8Array) => void) => void;
  onInferenceData: (callback: (data: any) => void) => void;
}

declare global {
  interface Window {
    database: DatabaseAPI;
    rasp_connection: RaspConnectionAPI;
  }
}
