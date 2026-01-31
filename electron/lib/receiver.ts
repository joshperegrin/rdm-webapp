import net from "net"
import dgram from "dgram"
import { app } from 'electron'
import path from 'node:path'

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

class ReceiverClient {
  rasp_ip: string = "192.168.1.14";
  rasp_port: number = 12345;
  liveInferencePreview: boolean = false;
  private port: number = 12345;
  private client: net.Socket;
  private udpListener: dgram.Socket | null = null;
  private pendingRequests: PendingRequest[] = [];
  private receivedBuffer: Buffer = Buffer.alloc(0);
  private udpInferenceSender: dgram.Socket | null = null;

  constructor(){
    this.client = new net.Socket();
    this.client.on('data', (data) => this.processTCPResponse(data))
  }
  
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

  connectClient(rasp_ip: string, rasp_port: number): Promise<void>{
    this.rasp_port = rasp_port;
    this.rasp_ip = rasp_ip;
    return new Promise((resolve, reject) => {
      this.client.connect(this.rasp_port, this.rasp_ip, () => resolve()) 
      this.client.once('error', reject)
    })
  }

  sendStartRequest(previewCallback: (buffer: Buffer) => void){
    if(this.udpListener){
      console.warn("Capture already started");
      return Promise.resolve(Response.SUCC_START)
    }

    try {
      this.udpListener = dgram.createSocket('udp4');
      this.udpListener.bind(this.port);
      this.udpListener.on('message', (msg, rinfo) => this.processUDPPacket(msg, rinfo, previewCallback))
      this.udpListener.on('error', (err) => {
        console.error("UDP Error:", err);
        this.udpListener?.close();
        this.udpListener = null;
      })
      
      this.udpInferenceSender = dgram.createSocket('udp4');
      this.udpInferenceSender.on("message", (msg, rinfo) => this.handleInferenceMessage(msg, rinfo, previewCallback))
      this.udpInferenceSender.on('error', (err) => {
        console.error("UDP Error:", err);
        this.udpInferenceSender?.close();
        this.udpInferenceSender = null;
      })
    } catch (e) {
      console.error("Failed to bind UDP port", e);
      return Promise.resolve(Response.ERROR_START)
    }
    
    const config = { receiver_port: this.port };
    const payload = Buffer.from(JSON.stringify(config), 'utf-8');
    return this.sendCommand(Command.START_CAPTURE, payload)
  }

  async sendStopRequest(){
    const response = await this.sendCommand(Command.STOP_CAPTURE, Buffer.alloc(0))
    if (this.udpListener){
      this.udpListener.close();
      this.udpListener = null;
    }
    return response;
  }

  private processTCPResponse(data: string | Buffer) {
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
      if (msg.length < 2) return;
      const jsonLength = msg.readUInt16BE(0);
      if (msg.length < 2 + jsonLength) return;

      const imageBuffer = msg.subarray(2 + jsonLength);
      if (imageBuffer.length === 0) return;

      const prependByte = this.liveInferencePreview? 0x01 : 0x00;
      const newMsg = Buffer.allocUnsafe(msg.length + 1)
      newMsg[0] = prependByte;
      msg.copy(newMsg, 1)
      
      if(!this.liveInferencePreview) previewCallback(imageBuffer)
      this.udpInferenceSender?.send(newMsg, 9123, "127.0.0.1")

    } catch (err) {
      console.error("Error decoding UDP packet:", err);
    }
  }

  private handleInferenceMessage(msg: Buffer, rinfo: dgram.RemoteInfo, previewCallback: (buffer: Buffer) => void){
    console.log("Inference Received")
  }
}

// --- FIXED FUNCTION ---
export function getPythonScript(scriptName: string): {pythonPath: string, scriptPath: string} {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'python.exe' : 'bin/python3';

  // FIX: Use process.cwd() in dev (Project Root) or resourcesPath in prod
  // This avoids the need for __dirname or __filename completely.
  const baseResources = app.isPackaged
    ? process.resourcesPath
    : path.join(process.cwd(), 'resources'); 

  // Construct paths
  const pythonPath = app.isPackaged
    ? path.join(baseResources, 'python', binaryName)
    : path.join(baseResources, 'python/', (isWin? 'win': 'linux'), binaryName);

  const scriptPath = app.isPackaged
    ? path.join(baseResources, 'app_scripts', scriptName)
    : path.join(baseResources, 'scripts', scriptName);

  return { pythonPath, scriptPath };
}

export default ReceiverClient;