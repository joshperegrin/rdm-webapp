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
}

class ReceiverClient {
  rasp_ip: string = "192.168.1.14";
  rasp_port: number = 12345;
  private port: number = 12345;
  private client: net.Socket;
  private udpListener: dgram.Socket;
  
  constructor(){
    this.client = new net.Socket();
    this.client.on('data', this.processTCPResponse)
    this.udpListener = dgram.createSocket('udp4');
    this.udpListener.on('message', this.processUDPPacket)
  }
  
  connectClient(rasp_ip: string, rasp_port: number){
    this.rasp_port = rasp_port;
    this.rasp_ip = rasp_ip;
    this.client.connect(this.rasp_port, this.rasp_ip) // TODO: Add Error
  }

  sendStartRequest(){
    // initialize the listener
    this.udpListener.bind(this.port);
    
    // prepare packet
    const config = {
      receiver_port: this.port
    };

    const payloadBuffer = Buffer.from(JSON.stringify(config), 'utf-8');
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payloadBuffer.length, 0);
    header.writeUInt32BE(Command.START_CAPTURE, 4);
    const packet = Buffer.concat([header, payloadBuffer]);

    // send packet
    this.client.write(packet);
  }

  sendStopRequest(){
    this.client.write(Buffer.from([Command.STOP_CAPTURE])); 
    this.udpListener.close(); // Add notification system for notifying events
  }

  private processTCPResponse(data: string | NonSharedBuffer) {}
  private processUDPPacket(msg: NonSharedBuffer, rinfo: dgram.RemoteInfo) {
    console.log(msg)
    // decode
    // image on buffer
    // send buffer to renderer
    // send buffer to inference
    // send buffer to write file system
  }
}

export default ReceiverClient;
