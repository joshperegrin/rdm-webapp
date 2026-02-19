import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ReceiverClient from './lib/receiver'
import { 
  getRoadDefectsBySession, 
  markRoadDefectFixed, 
  archiveRoadDefect, 
  getAllSessions,
} from './database/road.defect.model'
import db from './database/db'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// Initialize receiver here to maintain state
const receiver = new ReceiverClient()

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // --- HANDLERS ---

  // 1. Connection
  ipcMain.handle('rasp_connection:connect_client', (_, data) => receiver.connectClient(data.rasp_ip, data.rasp_port))
  
  // 2. Start Capture
  // The callback passed here handles the image frame.
  // ReceiverClient decides whether to pass the Raw Frame (from Pi) or Annotated Frame (from Python)
  // based on the 'liveInferencePreview' toggle.
  ipcMain.handle('rasp_connection:send_startreq', () => {
    return receiver.sendStartRequest((buffer)=> {
      const safeData = new Uint8Array(buffer);
      if(win && !win.isDestroyed()){
        win.webContents.send('preview-frame', safeData)
      }
    })
  })
  // 3. Stop Capture
  ipcMain.handle('rasp_connection:send_stopreq', async () => receiver.sendStopRequest())

  // 4. Toggle Preview Mode
  // Renderer calls this with true/false.
  ipcMain.handle('rasp_connection:toggle_preview', (_, showAnnotated: boolean) => {
    receiver.liveInferencePreview = showAnnotated;
    console.log(`[MAIN] Preview Mode Switched. Annotated: ${showAnnotated}`);
    return true;
  })

  // 5. Inference Data Listener
  // This listener is ALWAYS active once set. It sends JSON tracking data to the frontend
  // regardless of which video stream is being viewed.
  const sentInferenceIds = new Set<number>();
  receiver.setInferenceCallback((data) => {
    if (!win || win.isDestroyed()) return;
    if (!Array.isArray(data) || data.length === 0) return;
    const unique = data.filter((d: any) => d && typeof d.id === 'number' && !sentInferenceIds.has(d.id));
    if (unique.length === 0) return;
    unique.forEach((d: any) => sentInferenceIds.add(d.id));
    win.webContents.send('inference-data', unique);
  })
  
  ipcMain.handle('db:get-sessions', async () => {
     return await getAllSessions();
  });

  ipcMain.handle('db:get-road-defects', async (_, sessionId: number) => {
    return await getRoadDefectsBySession(sessionId);
  });

  ipcMain.handle('db:mark-fixed', async (_, rdId: number) => {
    return await markRoadDefectFixed(rdId);
  });

  ipcMain.handle('db:archive', async (_, rdId: number) => {
    return await archiveRoadDefect(rdId);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
