import { Button } from "@/components/ui/button";
import { useAtom } from "jotai";
import { CirclePlay, CircleStop, Loader2, Wifi, Activity, MapPin, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { imgUrlAtom, setDetectionImageFrame, detected_RD_Atom } from "@/state";

enum Response {
  CONN_SUCCESS    = 0x10,
  CONN_FAIL       = 0x11,
  SUCC_START      = 0x12,
  ERROR_START     = 0x13,
  SUCC_STOP       = 0x14,
  ERROR_STOP      = 0x15,
  TIMEOUT         = 0x99,
}

function DetectionPage() {
  const [isDetecting, setIsDetecting] = useState(0) // 0: idle, 1: detecting, 2: loading
  const [imgUrl, _] = useAtom(imgUrlAtom)
  const [detectedRD, __] = useAtom(detected_RD_Atom)
  useEffect(() => {
    if (window.rasp_connection) {
       window.rasp_connection.onPreviewFrame((buffer: Uint8Array) => {
         setDetectionImageFrame(buffer as any)
       })
    }
  }, [])

  const connect_client = () => {
    // @ts-ignore
    window.rasp_connection.connect_client("192.168.1.14", 12345)
  }

  const toggle_detection = async () => {
    const is_detecting = (isDetecting === 0) ? false : (isDetecting === 1) ? true : null;
    setIsDetecting(2)
    
    try {
      if (is_detecting === true) {
        // @ts-ignore
        const response = await window.rasp_connection.send_stopreq()
        setIsDetecting((response === Response.SUCC_STOP) ? 0 : 1)
      } else if (is_detecting === false) {
        // @ts-ignore
        const response = await window.rasp_connection.send_startreq()
        setIsDetecting((response === Response.SUCC_START) ? 1 : 0)
      }
    } catch (error) {
      console.error("Failed to toggle detection", error)
      setIsDetecting(is_detecting ? 1 : 0) // Revert state on error
    }
  }

  return (
    <div className="flex flex-row h-full w-full bg-slate-50 dark:bg-slate-900 p-4 gap-4 overflow-hidden">
      
      {/* Left Panel: Controls & List */}
      <div className="flex flex-col w-full md:w-1/3 lg:w-1/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        
        {/* Header / Controls */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500"/>
            Detection Control
          </h2>
          
          <div className="grid grid-cols-2 gap-2">
            <Button 
              onClick={toggle_detection} 
              variant={isDetecting === 1 ? "destructive" : "default"} 
              className="w-full"
              disabled={isDetecting === 2}
            >
              {isDetecting === 0 ? (
                <><CirclePlay className="mr-2 h-4 w-4"/> Start</>
              ) : isDetecting === 1 ? (
                <><CircleStop className="mr-2 h-4 w-4"/> Stop</>
              ) : (
                <Loader2 className="mr-2 h-4 w-4 animate-spin"/> 
              )}
            </Button>
            
            <Button onClick={connect_client} variant="outline" className="w-full">
              <Wifi className="mr-2 h-4 w-4"/> Connect
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 text-xs font-medium text-slate-500 uppercase tracking-wider flex justify-between items-center">
          <span>Detections Log</span>
          <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
            {detectedRD.length} Total
          </span>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {detectedRD.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
              <Activity className="w-12 h-12 mb-2 opacity-20"/>
              <p className="text-sm">No detections yet.</p>
              <p className="text-xs">Start detection to see events.</p>
            </div>
          ) : (
            [...detectedRD].reverse().map((rd, index) => (
              <div 
                key={`${rd.id}-${index}`} 
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-sm"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    ID: {rd.id}
                  </span>
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                    Class {rd.classification}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 gap-1 text-slate-500 dark:text-slate-400 text-xs mt-2">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3 h-3"/>
                    <span>{rd.location ? `[${rd.location[0].toFixed(5)}, ${rd.location[1].toFixed(5)}]` : 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3"/>
                    <span>{new Date(rd.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel: Preview */}
      <div className="flex-1 bg-black rounded-xl shadow-inner overflow-hidden flex items-center justify-center relative">
        {imgUrl ? (
          <img src={imgUrl} className="w-full h-full object-contain" alt="Live Stream" />
        ) : (
          <div className="text-white/30 flex flex-col items-center">
            <Wifi className="w-16 h-16 mb-4 opacity-20"/>
            <p>Waiting for video stream...</p>
          </div>
        )}
        
        {/* Overlay Badge */}
        <div className="absolute top-4 right-4 flex gap-2">
            {isDetecting === 1 && (
                <span className="animate-pulse bg-red-500/80 text-white text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1">
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                    LIVE
                </span>
            )}
        </div>
      </div>

    </div>
  )
}

export default DetectionPage;
