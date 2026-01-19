import net from "net"
import dgram from "dgram"

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
  private port: number = 12345;
  private client: net.Socket;
  private udpListener: dgram.Socket | null = null;
  private pendingRequests: PendingRequest[] = [];
  private receivedBuffer: Buffer = Buffer.alloc(0);

  constructor(){
    this.client = new net.Socket();
    this.client.on('data', (data) => this.processTCPResponse(data))
  }
  

  private sendCommand(cmd: Command, payload: Buffer, timeoutMs: number = 2000): Promise<Response>{
    return new Promise((resolve) => {
      // prepare packet
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
      this.client.connect(this.rasp_port, this.rasp_ip, () => resolve()) // TODO: Add Error
      this.client.once('error', reject)
    })
  }

  sendStartRequest(){
    // initialize the listener
    
    if(this.udpListener){
      console.warn("Capture already started");
      return Promise.resolve(Response.SUCC_START)
    }

    try {
      console.log("LMAOOO")
      this.udpListener = dgram.createSocket('udp4');
      this.udpListener.bind(this.port);
      this.udpListener.on('message', (msg, rinfo) => this.processUDPPacket(msg, rinfo))
      this.udpListener.on('error', (err) => {
        console.error("UDP Error:", err);
        this.udpListener?.close();
        this.udpListener = null;
      })
      
    } catch (e) {
      console.error("Failed to bind UDP port", e);
      return Promise.resolve(Response.ERROR_START)
    }
    
    // prepare packet
    const config = {
      receiver_port: this.port
    };
    const payload = Buffer.from(JSON.stringify(config), 'utf-8');

    console.log("TESTINGGG")
    // send packet
    return this.sendCommand(Command.START_CAPTURE, payload)
  }

  async sendStopRequest(){
    const response = await this.sendCommand(Command.STOP_CAPTURE, Buffer.alloc(0))
    console.log("TESTINGGG2")
    if (this.udpListener){
      this.udpListener.close();
      this.udpListener = null;
    }
    return response;
  }

  private processTCPResponse(data: string | NonSharedBuffer) {
    // Append new data to buffer
    this.receivedBuffer = Buffer.concat([this.receivedBuffer, Buffer.from(data)])

    // Process complete message in buffer

    while(true){
      if(this.receivedBuffer.length < 8) break;
      const length = this.receivedBuffer.readUInt32BE(0);
      const cmdID = this.receivedBuffer.readUInt32BE(4);

      if (this.receivedBuffer.length < 8 + length) break
      
      this.receivedBuffer = this.receivedBuffer.subarray(8+length);

      // Handle CONN_SUCCESS

      if (cmdID === Response.CONN_SUCCESS) {
        console.log("Server Connected")
        continue;
      }

      const req = this.pendingRequests.shift()
      if(req){
        clearTimeout(req.timer);
        req.resolve(cmdID as Response);
      } else {
        console.warn("Received response but no pending request: ", cmdID)
      }
    
    }
    // Resolve oldest pending request
  }
  private processUDPPacket(msg: NonSharedBuffer, rinfo: dgram.RemoteInfo) {
    try {
      // Extract JSON Length
      if (msg.length < 2) return;
      const jsonLength = msg.readUInt16BE(0);
      if (msg.length < 2 + jsonLength) {
        console.warn("Packet too short for declared JSON length");
        return;
      }

      // Extract GPS
      const jsonStartIdx = 2;
      const jsonEndIdx = 2 + jsonLength;
      const jsonBuffer = msg.subarray(jsonStartIdx, jsonEndIdx);
      const gpsData = JSON.parse(jsonBuffer.toString('utf-8'));

      console.log("Telemetry Received: ", gpsData);

      // Extract Image Data
      const imageBuffer = msg.subarray(jsonEndIdx);

      // Verify we actually have image data
      if (imageBuffer.length === 0) return;

      console.log("Image Data: ", imageBuffer)
      // A. Send to Renderer (e.g., frontend via WebSocket)
      // this.sendToRenderer(imageBuffer, gpsData);

      // B. Send to Inference (e.g., Object detection)
      // this.runInference(imageBuffer);

      // C. Write to File System
      // this.saveFrame(imageBuffer, gpsData);

    } catch (err) {
      console.error("Error decoding UDP packet:", err);
    }
  }
}

export default ReceiverClient;
