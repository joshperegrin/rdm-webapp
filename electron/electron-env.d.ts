/// <reference types="vite-plugin-electron/electron-env" />
import {Response} from './lib/receiver'

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
declare global {
  interface Window {
    rasp_connection: {
      connect_client: (rasp_ip: string, rasp_port: number) => Promise<Response>
      send_startreq: () => Promise<Response>
      send_stopreq: () => Promise<Response>
      onPreviewFrame: (callback: (buffer: Uint8Array) => void) => void
    }
  }
}

export {}
