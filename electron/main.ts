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
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

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
  const reciever = new ReceiverClient()
  
  ipcMain.handle('rasp_connection:connect_client', (_, data) => reciever.connectClient(data.rasp_ip, data.rasp_port))
  ipcMain.handle('rasp_connection:send_startreq', () => {
    return reciever.sendStartRequest((buffer)=> {
      const safeData = new Uint8Array(buffer);
      if(win && !win.isDestroyed()){
        win.webContents.send('preview-frame', safeData)
      }
    })
  })
  ipcMain.handle('rasp_connection:send_stopreq', async () => reciever.sendStopRequest())
  
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

// Quit when all windows are closed, except on macOS. There, it's common
// for appkications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
