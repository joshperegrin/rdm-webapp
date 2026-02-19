import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose Database API ---------
contextBridge.exposeInMainWorld('database', {
  // Frontend calls window.database.getSessions() -> triggers 'db:get-sessions' in Main
  getSessions: () => ipcRenderer.invoke('db:get-sessions'),
  getRoadDefectsBySession: (sessionId: number) => ipcRenderer.invoke('db:get-road-defects', sessionId),
  markFixed: (rdId: number) => ipcRenderer.invoke('db:mark-fixed', rdId),
  archive: (rdId: number) => ipcRenderer.invoke('db:archive', rdId),
})

// --------- Raspberry Pi API (Keep existing) ---------
contextBridge.exposeInMainWorld('rasp_connection', {
  connect_client: (rasp_ip: string, rasp_port: number) => ipcRenderer.invoke('rasp_connection:connect_client', { rasp_ip: rasp_ip, rasp_port: rasp_port }),
  send_startreq: () => ipcRenderer.invoke('rasp_connection:send_startreq'),
  send_stopreq: () => ipcRenderer.invoke('rasp_connection:send_stopreq'),
  onPreviewFrame: (callback: (buffer: Uint8Array) => void) => {ipcRenderer.on('preview-frame', (_event, value) => callback(value))},
  onInferenceData: (callback: (data: any) => void) => {ipcRenderer.on('inference-data', (_event, value) => callback(value))}
})
