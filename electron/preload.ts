import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('rasp_connection', {
  connect_client: (rasp_ip: string, rasp_port: number) => ipcRenderer.invoke('rasp_connection:connect_client', { rasp_ip: rasp_ip, rasp_port: rasp_port }),
  send_startreq: () => ipcRenderer.invoke('rasp_connection:send_startreq'),
  send_stopreq: () => ipcRenderer.invoke('rasp_connection:send_stopreq')
})
