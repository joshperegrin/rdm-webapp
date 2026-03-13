import { app, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import ReceiverClient from './lib/receiver'
import { 
  getRoadDefectsBySession, 
  markRoadDefectFixed, 
  archiveRoadDefect, 
  getAllSessions,
} from './database/road.defect.model'

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
  {
    scheme: 'localfile',
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
        const buffer = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = []
          const stream = fs.createReadStream(filePath, { start, end })
          stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          stream.on('end', () => resolve(Buffer.concat(chunks)))
          stream.on('error', reject)
        })
        headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        headers.set('Content-Length', String(buffer.byteLength))
        return new Response(buffer, { status: 206, headers })
      }

      const buffer = await fs.promises.readFile(filePath)
      headers.set('Content-Length', String(buffer.byteLength))
      return new Response(buffer, { status: 200, headers })

    } catch (error) {
      console.error('[pmtiles] Failed to load', filePath, error)
      return new Response('Not found', { status: 404 })
    }
  })
}

function registerLocalFileProtocol() {
  const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']

  protocol.handle('localfile', async (request) => {
    try {
      // Path is stored as a query param to avoid drive letter being parsed as hostname
      // e.g. localfile://file?path=C%3A%2FUsers%2F...%2F4.jpg
      const url = new URL(request.url)
      const rawPath = url.searchParams.get('path')

      if (!rawPath) {
        console.warn('[localfile] Missing path query param:', request.url)
        return new Response('Bad Request', { status: 400 })
      }

      // Normalize to OS-native path
      const absolutePath = path.normalize(rawPath)

      // Security: only allow image file extensions
      const ext = path.extname(absolutePath).toLowerCase()
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        console.warn('[localfile] Blocked non-image file:', absolutePath)
        return new Response('Forbidden', { status: 403 })
      }

      console.log('[localfile] Serving:', absolutePath)
      return net.fetch(pathToFileURL(absolutePath).toString())
    } catch (error) {
      console.error('[localfile] Failed to serve file:', error)
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
  ipcMain.handle('rasp_connection:toggle_preview', (_, showAnnotated: boolean) => {
    receiver.liveInferencePreview = showAnnotated;
    console.log(`[MAIN] Preview Mode Switched. Annotated: ${showAnnotated}`);
    return true;
  })

  // 5. Inference Data Listener
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
  registerLocalFileProtocol()
  createWindow()
})