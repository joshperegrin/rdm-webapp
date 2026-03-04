import net from "net"
import dgram from "dgram"
import { app } from 'electron'
import path from 'node:path'
import { ChildProcess, spawn } from "child_process"; 
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { saveSessionWithDetails, SessionSavePayload } from "../database/road.defect.model";

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface InferenceData {
  id: number;
  class: number;
  box: [number, number, number, number]; // x1, y1, x2, y2
}

export interface InferenceDataWithMeta extends InferenceData {
  lat: number;
  lng: number;
  timestamp: string;
}
// REMOVED: const __filename / __dirname polyfills (They cause conflicts)

export enum Command {
  HEARTBEAT       = 0x01,
  START_CAPTURE   = 0x02,
  STOP_CAPTURE    = 0x03,
  REQ_CAM_DETAILS = 0x05,
}

export enum Response {
  CONN_SUCCESS    = 0x10,
  CONN_FAIL       = 0x11,
  SUCC_START      = 0x12,
  ERROR_START     = 0x13,
  SUCC_STOP       = 0x14,
  ERROR_STOP      = 0x15,
  TIMEOUT         = 0x99,
}

export interface PendingRequest {
  resolve: (res: Response) => void;
  timer: NodeJS.Timeout;
}

interface GpsPacket {
  lat: number;
  lng: number;
  timestamp: string;
}

interface RoadDefectAggregate {
  sumLat: number;
  sumLng: number;
  count: number;
  classification: string | null;
  thumbnail_path: string;
}

class ReceiverClient {
  // rasp_ip: string = "192.168.1.14";
  rasp_ip: string = "10.42.0.1";
  rasp_port: number = 12345;
  
  // Toggle this to control if Python sends back an image
  public liveInferencePreview: boolean = true; 

  private port: number = 12345;
  private client: net.Socket;
  private udpListener: dgram.Socket | null = null;
  private pendingRequests: PendingRequest[] = [];
  private receivedBuffer: Buffer = Buffer.alloc(0);
  private udpInferenceSender: dgram.Socket | null = null;
  private inferenceServer: ChildProcess | null = null;
  private inferenceOutputPath: string | null = null;
  private sessionActive: boolean = false;
  private sessionStart: GpsPacket | null = null;
  private sessionEnd: GpsPacket | null = null;
  private pendingFrameMeta: GpsPacket[] = [];
  private images: SessionSavePayload["images"] = [];
  private detections: SessionSavePayload["detections"] = [];
  private roadDefects = new Map<string, RoadDefectAggregate>();
  
  // Callback to send tracking data to the UI
  private onInferenceData: ((data: InferenceDataWithMeta[]) => void) | null = null;

  constructor(){
    this.client = new net.Socket();
    this.client.on('data', (data) => this.processTCPResponse(data))
  }

  public setInferenceCallback(cb: (data: InferenceDataWithMeta[]) => void) {
    this.onInferenceData = cb;
  }

  // private onInferencePacket: ((data: { frame_path: string | null; detections: InferenceData[] }) => void) | null = null;
  // public setInferencePacketCallback(cb: (data: { frame_path: string | null; detections: InferenceData[] }) => void) {
    // this.onInferencePacket = cb;
  // }

  private sendCommand(cmd: Command, payload: Buffer, timeoutMs: number = 2000): Promise<Response>{
    return new Promise((resolve) => {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(payload.length, 0);
      header.writeUInt32BE(cmd, 4);
      const packet = Buffer.concat([header, payload]);
      
      const timer = setTimeout(() => {
        const index = this.pendingRequests.findIndex(req => req.timer === timer);
        if (index !== -1){
          this.pendingRequests.splice(index, 1);
        }
        console.warn(`[TIMEOUT] Command ${cmd} timed out.`)
        resolve(Response.TIMEOUT);
      }, timeoutMs)

      this.pendingRequests.push({ resolve, timer });
      this.client.write(packet);
    })
  }

  connectClient(rasp_ip: string, rasp_port: number): Promise<boolean>{
    this.rasp_port = rasp_port;
    this.rasp_ip = rasp_ip;
    return new Promise((resolve, reject) => {
      this.client.connect(this.rasp_port, this.rasp_ip, () => resolve(true)) 
      this.client.once('error', reject)
    })
  }

  async disconnectClient(): Promise<void> {
    try {
      if (this.client && !this.client.destroyed) {
        await this.sendStopRequest();
      }
    } catch {
      // best-effort stop
    }

    if (this.udpListener){
      this.udpListener.close();
      this.udpListener = null;
    }
    if (this.udpInferenceSender) {
      this.udpInferenceSender.close();
      this.udpInferenceSender = null;
    }

    this.pendingRequests.forEach((req) => clearTimeout(req.timer));
    this.pendingRequests = [];
    this.receivedBuffer = Buffer.alloc(0);

    if (this.client && !this.client.destroyed) {
      this.client.end();
      this.client.destroy();
    }
  }

  async sendStartRequest(previewCallback: (buffer: Buffer) => void){
    if(this.udpListener){
      console.warn("Capture already started");
      return Promise.resolve(Response.SUCC_START)
    }

    try {
      if (this.inferenceServer) {
        this.inferenceServer.kill();
        this.inferenceServer = null;
      }

      // 1. Create listener for raspberry pi stream
      this.udpListener = dgram.createSocket('udp4');
      this.udpListener.bind(this.port);
      this.udpListener.on('message', (msg, rinfo) => this.processUDPPacket(msg, rinfo, previewCallback))
      this.udpListener.on('error', (err) => {
        console.error("UDP Error:", err);
        this.udpListener?.close();
        this.udpListener = null;
      })
      
      // 2. Create a sender for sending frames for inference
      this.udpInferenceSender = dgram.createSocket('udp4');
      this.udpInferenceSender.on("message", (msg, rinfo) => this.handleInferenceMessage(msg, rinfo, previewCallback))
      this.udpInferenceSender.on('error', (err) => {
        console.error("UDP Error:", err);
        this.udpInferenceSender?.close();
        this.udpInferenceSender = null;
      })

      // 3. Spawn server (Optional: implement if needed)
      if(this.inferenceServer === null){
        const {pythonPath, scriptPath} = getPythonScript("inference_rfdetr.py")
        this.inferenceOutputPath = getInferenceOutputPath();
        this.resetSessionState();
        this.inferenceServer = spawn(pythonPath, ['-u', scriptPath, this.inferenceOutputPath], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
          },
        })
        this.inferenceServer.stdout?.on('data', (chunk) => {
          console.log(`[INFERENCE] ${chunk.toString().trim()}`);
        })
        this.inferenceServer.stderr?.on('data', (chunk) => {
          console.error(`[INFERENCE] ${chunk.toString().trim()}`);
        })
        this.inferenceServer.on('exit', (code, signal) => {
          console.warn(`[INFERENCE] Exited code=${code} signal=${signal}`);
          this.inferenceServer = null;
        })
        this.inferenceServer.on('error', (err) => {
          console.error("[INFERENCE] Spawn error:", err);
          this.inferenceServer = null;
        })
      }

    } catch (e) {
      console.error("Failed to bind UDP port", e);
      return Promise.resolve(Response.ERROR_START)
    }
    
    // Prepare packet
    const config = {
      receiver_port: this.port
    };
    const payload = Buffer.from(JSON.stringify(config), 'utf-8');

    const resetPacket = Buffer.from([0x02, 0x00, 0x00]);
    this.udpInferenceSender?.send(resetPacket, 9123, "127.0.0.1");
    console.log(`[INFERECE] UDP reset sent to 127.0.0.1:9123 (${resetPacket.length} bytes)`);

    return this.sendCommand(Command.START_CAPTURE, payload)
  }

  async sendStopRequest(){
    if (this.udpInferenceSender) {
      const stopPacket = Buffer.from([0x02, 0x00, 0x00]);
      this.udpInferenceSender.send(stopPacket, 9123, "127.0.0.1");
    }
    const response = await this.sendCommand(Command.STOP_CAPTURE, Buffer.alloc(0))
    if (this.inferenceServer) {
      this.inferenceServer.kill();
      this.inferenceServer = null;
    }
    await this.saveCurrentSession();
    if (this.udpListener){
      this.udpListener.close();
      this.udpListener = null;
    }
    if (this.udpInferenceSender) {
        this.udpInferenceSender.close();
        this.udpInferenceSender = null;
    }
    return response;
  }

  private processTCPResponse(data: Buffer | string) {
    this.receivedBuffer = Buffer.concat([this.receivedBuffer, Buffer.from(data)])

    while(true){
      if(this.receivedBuffer.length < 8) break;
      const length = this.receivedBuffer.readUInt32BE(0);
      const cmdID = this.receivedBuffer.readUInt32BE(4);

      if (this.receivedBuffer.length < 8 + length) break
      
      this.receivedBuffer = this.receivedBuffer.subarray(8+length);

      if (cmdID === Response.CONN_SUCCESS) {
        console.log("Server Connected")
        continue;
      }

      const req = this.pendingRequests.shift()
      if(req){
        clearTimeout(req.timer);
        req.resolve(cmdID as Response);
      }
    }
  }

  private processUDPPacket(msg: Buffer, rinfo: dgram.RemoteInfo, previewCallback: (buffer: Buffer) => void) {
    try {
      // Extract JSON Length to find image start
      if (msg.length < 2) return;
      const jsonLength = msg.readUInt16BE(0);
      if (msg.length < 2 + jsonLength) return;

      const jsonBuffer = msg.subarray(2, 2 + jsonLength);
      const gps = this.parseGpsPacket(jsonBuffer);
      if (gps) {
        if (!this.sessionStart) {
          this.sessionStart = gps;
          this.sessionActive = true;
        }
        this.sessionEnd = gps;
        this.pendingFrameMeta.push(gps);
      }

      const imageBuffer = msg.subarray(2 + jsonLength);
      if (imageBuffer.length === 0) return;

      // 1. If we are NOT in live inference mode, we just show the raw frame from Pi immediately
      if(!this.liveInferencePreview) {
          previewCallback(imageBuffer)
      }

      // 2. Prepare data for Python
      // Prepend the LivePreview Toggle Byte (1 = Send Image Back, 0 = Don't)
      const prependByte = this.liveInferencePreview ? 0x01 : 0x00;
      const newMsg = Buffer.allocUnsafe(msg.length + 1)
      newMsg[0] = prependByte;
      msg.copy(newMsg, 1)
      
      // Send to Python Inference Server
      if(!this.liveInferencePreview) previewCallback(imageBuffer)
      this.udpInferenceSender?.send(newMsg, 9123, "127.0.0.1")
      console.log(`[Inference] UDP frame sent to 127.0.0.1:9123`)

    } catch (err) {
      console.error("Error decoding UDP packet:", err);
    }
  }

  private handleInferenceMessage(msg: Buffer, rinfo: dgram.RemoteInfo, previewCallback: (buffer: Buffer) => void){
    try {
        if (msg.length < 3) return;
  
        // 1. Read Protocol Header
        const flag = msg.readUInt8(0); // 0x01 = JSON Only, 0x02 = JSON + Image
        const jsonLength = msg.readUInt16BE(1);
  
        if (msg.length < 3 + jsonLength) return;
  
        // 2. Parse JSON (Tracking Data)
        const jsonBuffer = msg.subarray(3, 3 + jsonLength);
        const inferencePayload = JSON.parse(jsonBuffer.toString('utf-8')) as {
          frame_path: string | null;
          detections: InferenceData[];
        };

        const frameMeta = this.pendingFrameMeta.shift() ?? this.sessionEnd ?? {
          lat: 0,
          lng: 0,
          timestamp: new Date().toISOString(),
        };
  
        // Emit Inference Data to UI (Always happens)
        if (this.onInferenceData) {
          const detections = Array.isArray(inferencePayload.detections)
            ? inferencePayload.detections
            : [];
          const detectionsWithMeta = detections.map((d) => ({
            ...d,
            lat: frameMeta.lat,
            lng: frameMeta.lng,
            timestamp: frameMeta.timestamp,
          }));
          this.onInferenceData(detectionsWithMeta);
        }

        this.captureInferenceForSession(inferencePayload, frameMeta);
  
        // 3. Parse Image (Only if Flag is 0x02 AND we are in live preview mode)
        if (flag === 0x02 && this.liveInferencePreview) {
          const imageBuffer = msg.subarray(3 + jsonLength);
          if (imageBuffer.length > 0) {
            previewCallback(imageBuffer);
          }
        }
      } catch (e) {
        console.error("Error parsing inference response:", e);
      }
  }

  private resetSessionState() {
    this.sessionActive = false;
    this.sessionStart = null;
    this.sessionEnd = null;
    this.pendingFrameMeta = [];
    this.images = [];
    this.detections = [];
    this.roadDefects.clear();
  }

  private parseGpsPacket(jsonBuffer: Buffer): GpsPacket | null {
    try {
      const data = JSON.parse(jsonBuffer.toString("utf-8")) as {
        lat?: number;
        long?: number;
      };
      if (typeof data?.lat !== "number" || typeof data?.long !== "number") return null;
      return {
        lat: data.lat,
        lng: data.long,
        timestamp: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private captureInferenceForSession(
    payload: { frame_path: string | null; detections: InferenceData[] },
    meta: GpsPacket,
  ) {
    if (!this.sessionActive) return;

    const detections = Array.isArray(payload.detections) ? payload.detections : [];
    const framePath = payload.frame_path ?? null;
    if (!framePath || detections.length === 0) return;

    const imageKey = randomUUID();
    this.images.push({
      key: imageKey,
      lat: meta.lat,
      lng: meta.lng,
      timestamp: meta.timestamp,
      img_path: framePath,
    });

    detections.forEach((d) => {
      const roadKey = String(d.id ?? "");
      if (!roadKey) return;

      const existing = this.roadDefects.get(roadKey);
      if (existing) {
        existing.sumLat += meta.lat;
        existing.sumLng += meta.lng;
        existing.count += 1;
        if (!existing.classification && d.class !== undefined) {
          existing.classification = String(d.class);
        }
      } else {
        const thumbnailBase = this.inferenceOutputPath ?? "";
        const thumbnailPath = path.join(thumbnailBase, "crops", `${roadKey}.jpg`);
        this.roadDefects.set(roadKey, {
          sumLat: meta.lat,
          sumLng: meta.lng,
          count: 1,
          classification: d.class !== undefined ? String(d.class) : null,
          thumbnail_path: thumbnailPath,
        });
      }

      this.detections.push({
        image_key: imageKey,
        road_defect_key: roadKey,
        bbox: JSON.stringify(d.box ?? []),
        classification: d.class !== undefined ? String(d.class) : null,
        calc_lat: meta.lat,
        calc_lng: meta.lng,
      });
    });
  }

  private async saveCurrentSession() {
    if (!this.sessionActive) return;

    const start = this.sessionStart ?? {
      lat: 0,
      lng: 0,
      timestamp: new Date().toISOString(),
    };
    const end = this.sessionEnd ?? start;

    const road_defects: SessionSavePayload["road_defects"] = [];
    for (const [key, value] of this.roadDefects.entries()) {
      const count = value.count || 1;
      road_defects.push({
        key,
        ave_lat: value.sumLat / count,
        ave_lng: value.sumLng / count,
        ave_classification: value.classification ?? null,
        city: null,
        thumbnail_path: value.thumbnail_path,
        is_fixed: 0,
        is_archived: 0,
      });
    }

    const payload: SessionSavePayload = {
      session: {
        timestamp: start.timestamp,
        start_lat: start.lat,
        start_lng: start.lng,
        end_lat: end.lat,
        end_lng: end.lng,
      },
      images: this.images,
      road_defects,
      detections: this.detections,
    };

    try {
      await saveSessionWithDetails(payload);
    } catch (err) {
      console.error("[SESSION SAVE] Failed:", err);
    } finally {
      this.resetSessionState();
    }
  }
}

function getBaseResourcesPath(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(process.cwd(), 'resources');
}

function getInferenceOutputPath(): string {
  const shortId = randomUUID().replace(/-/g, "").slice(0, 12);
  return path.join(getBaseResourcesPath(), "captures", shortId);
}

// --- FIXED FUNCTION ---
export function getPythonScript(scriptName: string): {pythonPath: string, scriptPath: string} {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'python.exe' : 'bin/python3';

  const baseResources = getBaseResourcesPath();
  const pythonPath = app.isPackaged
    ? path.join(baseResources, 'python', binaryName)
    : path.join(baseResources, 'python/', (isWin? 'win': 'linux'), binaryName);

  const scriptPath = app.isPackaged
    ? path.join(baseResources, 'app_scripts', scriptName)
    : path.join(baseResources, 'scripts', scriptName);

  return { pythonPath, scriptPath };
}

export default ReceiverClient;
