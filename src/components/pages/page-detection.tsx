import { Button } from "@/components/ui/button";
import { useAtom } from "jotai";
import { CirclePlay, CircleStop, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { imgUrlAtom, setDetectionImageFrame } from "@/state";



enum Response {
  CONN_SUCCESS    = 0x10,
  CONN_FAIL       = 0x11,
  SUCC_START      = 0x12,
  ERROR_START     = 0x13,
  SUCC_STOP       = 0x14,
  ERROR_STOP      = 0x15,
  TIMEOUT         = 0x99,
}

function DetectionPage(){
  const [isDetecting, setIsDetecting] = useState(0) // 0 not detection, 1 detecting, 2 waiting for response
  const [imgUrl, _] = useAtom(imgUrlAtom)
  useEffect(() => {
    window.rasp_connection.onPreviewFrame((buffer: Uint8Array) => {
      setDetectionImageFrame(buffer as any)
    })
  }, [])
  const connect_client = () => {
    window.rasp_connection.connect_client("192.168.1.14", 12345)
  }
  const toggle_detection = async () => {
    const is_detecting = (isDetecting === 0)? false : (isDetecting === 1)? true : null;
    setIsDetecting(2)
    if (is_detecting === true) {
      const response = await window.rasp_connection.send_stopreq()
      setIsDetecting((response === Response.SUCC_STOP)? 1 : 0)
    } else if (is_detecting === false) {
      const response = await window.rasp_connection.send_startreq()
      setIsDetecting((response === Response.SUCC_START)? 0 : 1)
    } else {
      
    }
  }
  return (
    <div className="flex flex-row h-full w-full">
      <div className="hidden md:flex md:w-1/3 lg:w-90 ">
        <Button onClick={toggle_detection} className="cursor-pointer" variant="outline" size="sm">
          {isDetecting==0 ? (<><CirclePlay/> Start</>) : isDetecting==1 ? (<><CircleStop color="red"/> Stop</>) : (<Loader2 className="animate-spin"/>)}
          
        </Button>
        <Button onClick={connect_client} className="cursor-pointer" variant="outline" size="sm">
          Connect
        </Button>
      </div>
      <div className="flex flex-1">
        <img src={imgUrl}/>
      </div>
    </div>
  )
}

export default DetectionPage;
