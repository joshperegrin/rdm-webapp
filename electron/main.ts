import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import ReceiverClient from './lib/receiver'
import { 
  getRoadDefectsBySession, 
  markRoadDefectFixed, 
  archiveRoadDefect, 
  getAllSessions,
} from './database/road.defect.model'
// import db from './database/db'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pmtiles',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// Initialize receiver here to maintain state
const receiver = new ReceiverClient()

function getMaptilesRoot() {
  return VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT, 'resources', 'maptiles')
    : path.join(process.resourcesPath, 'maptiles')
}

function resolvePmtilesPath(requestUrl: URL) {
  let hostAndPath = decodeURIComponent(`${requestUrl.hostname}${requestUrl.pathname}`)
  hostAndPath = hostAndPath.replace(/\/+$/, '')
  const safePath = path.normalize(hostAndPath).replace(/^(\.\.(\/|\\|$))+/, '')
  return path.join(getMaptilesRoot(), safePath)
}

function parseRangeHeader(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
  if (!match) return null

  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : size - 1

  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return null
  const clampedEnd = Math.min(end, size - 1)
  if (start > clampedEnd) return null
  return { start, end: clampedEnd }
}

function registerPmtilesProtocol() {
  protocol.handle('pmtiles', async (request) => {
    const requestUrl = new URL(request.url)
    const filePath = resolvePmtilesPath(requestUrl)

    if (!filePath.endsWith('.pmtiles')) {
      return new Response('Unsupported file type', { status: 400 })
    }

    try {
      const stat = fs.statSync(filePath)
      const range = parseRangeHeader(request.headers.get('range'), stat.size)
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/vnd.pmtiles',
      })

      if (range) {
        const { start, end } = range
        const stream = fs.createReadStream(filePath, { start, end })
        headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        headers.set('Content-Length', String(end - start + 1))
        return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
          status: 206,
          headers,
        })
      }

      const stream = fs.createReadStream(filePath)
      headers.set('Content-Length', String(stat.size))
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
        status: 200,
        headers,
      })
    } catch (error) {
      console.error('[pmtiles] Failed to load', filePath, error)
      return new Response('Not found', { status: 404 })
    }
  })
}

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
  ipcMain.handle('rasp_connection:disconnect_client', async () => {
    await receiver.disconnectClient();
    return true;
  })
  
  // 2. Start Capture
  // The callback passed here handles the image frame.
  // ReceiverClient decides whether to pass the Raw Frame (from Pi) or Annotated Frame (from Python)
  // based on the 'liveInferencePreview' toggle.
  ipcMain.handle('rasp_connection:send_startreq', () => {
    sentInferenceIds.clear();
    return receiver.sendStartRequest((buffer)=> {
      const safeData = new Uint8Array(buffer);
      if(win && !win.isDestroyed()){
        win.webContents.send('preview-frame', safeData)
      }
    })
  })
  // 3. Stop Capture
  ipcMain.handle('rasp_connection:send_stopreq', async () => {
    const res = await receiver.sendStopRequest();
    sentInferenceIds.clear();
    return res;
  })

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
  const sentInferenceWithoutLocation = new Set<number>();
  receiver.setInferenceCallback((data) => {
    if (!win || win.isDestroyed()) return;
    if (!Array.isArray(data) || data.length === 0) return;
    const toSend: any[] = [];
    data.forEach((d: any) => {
      if (!d || typeof d.id !== 'number') return;
      const hasLocation =
        Number.isFinite(d.lat) &&
        Number.isFinite(d.lng) &&
        !(d.lat === 0 && d.lng === 0);

      if (!sentInferenceIds.has(d.id)) {
        sentInferenceIds.add(d.id);
        if (!hasLocation) {
          sentInferenceWithoutLocation.add(d.id);
        }
        toSend.push(d);
        return;
      }

      if (sentInferenceWithoutLocation.has(d.id) && hasLocation) {
        sentInferenceWithoutLocation.delete(d.id);
        toSend.push(d);
      }
    });
    if (toSend.length > 0) {
      win.webContents.send('inference-data', toSend);
    }
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

app.whenReady().then(() => {
  registerPmtilesProtocol()
  createWindow()
})
