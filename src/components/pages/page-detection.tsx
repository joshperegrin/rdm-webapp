import { Button } from "@/components/ui/button";
import { useAtom } from "jotai";
import { CirclePlay, CircleStop, Loader2, Wifi, Activity, MapPin, Clock, Map, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { imgUrlAtom, setDetectionImageFrame, detected_RD_Atom, clearDetectedRD } from "@/state";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as protomapsL from "protomaps-leaflet";
import { Compression, type DecompressFunc, PMTiles } from "pmtiles";
import { ZstdCodec } from "zstd-codec";

enum RaspResponse {
  CONN_SUCCESS    = 0x10,
  CONN_FAIL       = 0x11,
  SUCC_START      = 0x12,
  ERROR_START     = 0x13,
  SUCC_STOP       = 0x14,
  ERROR_STOP      = 0x15,
  TIMEOUT         = 0x99,
}

let zstdSimplePromise: Promise<{ decompress: (data: Uint8Array) => Uint8Array }> | null = null;

const getZstdSimple = () => {
  if (!zstdSimplePromise) {
    zstdSimplePromise = new Promise((resolve, reject) => {
      try {
        ZstdCodec.run((zstd) => {
          resolve(new zstd.Simple());
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  return zstdSimplePromise;
};

const decompressPMTiles: DecompressFunc = async (buf, compression) => {
  if (compression === Compression.None || compression === Compression.Unknown) {
    return buf;
  }

  if (compression === Compression.Gzip || compression === Compression.Brotli) {
    if (typeof globalThis.DecompressionStream === "undefined") {
      throw new Error("DecompressionStream is not available in this runtime.");
    }
    const format = compression === Compression.Gzip ? "gzip" : "br";
    const stream = new Response(buf).body;
    if (!stream) {
      throw new Error("Failed to read compressed tile stream.");
    }
    const result = stream.pipeThrough(new globalThis.DecompressionStream(format));
    return new Response(result).arrayBuffer();
  }

  if (compression === Compression.Zstd) {
    const simple = await getZstdSimple();
    const output = simple.decompress(new Uint8Array(buf));
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  }

  throw new Error(`Unsupported PMTiles compression: ${compression}`);
};

function DetectionPage() {
  const [isDetecting, setIsDetecting] = useState(0) // 0: idle, 1: detecting, 2: loading
  const [isConnected, setIsConnected] = useState(false)
  const [viewMode, setViewMode] = useState<"video" | "map">("video")
  const [imgUrl, _] = useAtom(imgUrlAtom)
  const [detectedRD, __] = useAtom(detected_RD_Atom)
  const mapRef = useRef<L.Map | null>(null)
  const rdLayerRef = useRef<L.LayerGroup | null>(null)
  const pmtilesRef = useRef<PMTiles | null>(null)
  const PMTILES_URL = "pmtiles://philippines.pmtiles";

  useEffect(() => {
    if (window.rasp_connection) {
       window.rasp_connection.onPreviewFrame((buffer: Uint8Array) => {
         setDetectionImageFrame(buffer as any)
       })
    }
  }, [])

  const connect_client = async () => {
    try {
      // @ts-ignore
      // await window.rasp_connection.connect_client("192.168.1.14", 12345)
      await window.rasp_connection.connect_client("10.42.0.1", 12345)
      setIsConnected(true)
    } catch (error) {
      console.error("Failed to connect client", error)
      setIsConnected(false)
    }
  }

  const disconnect_client = async () => {
    try {
      // @ts-ignore
      await window.rasp_connection.disconnect_client()
      setIsConnected(false)
      setIsDetecting(0)
    } catch (error) {
      console.error("Failed to disconnect client", error)
    }
  }

  const toggle_detection = async () => {
    if (!isConnected) return
    const is_detecting = (isDetecting === 0) ? false : (isDetecting === 1) ? true : null;
    setIsDetecting(2)
    
    try {
      if (is_detecting === true) {
        // @ts-ignore
        const response = await window.rasp_connection.send_stopreq()
        if (response === RaspResponse.SUCC_STOP) {
          clearDetectedRD()
        }
        setIsDetecting((response === RaspResponse.SUCC_STOP) ? 0 : 1)
      } else if (is_detecting === false) {
        // @ts-ignore
        const response = await window.rasp_connection.send_startreq()
        setIsDetecting((response === RaspResponse.SUCC_START) ? 1 : 0)
      }
    } catch (error) {
      console.error("Failed to toggle detection", error)
      setIsDetecting(is_detecting ? 1 : 0) // Revert state on error
    }
  }

  useEffect(() => {
    if (viewMode !== "map") return;
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 0);
      return;
    }

    const initMap = () => {
      const container = document.getElementById("detection-map");
      if (!container) {
        console.warn("[RD] Map container not found");
        return;
      }
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        console.warn("[RD] Map container has zero size, retrying");
        setTimeout(initMap, 50);
        return;
      }

      try {
        mapRef.current = L.map(container).setView([12.8797, 121.7740], 6);
        if (!pmtilesRef.current) {
          pmtilesRef.current = new PMTiles(PMTILES_URL, undefined, decompressPMTiles);
        }

        protomapsL
          .leafletLayer({
            url: pmtilesRef.current,
            flavor: "light",
            lang: "en",
          })
          .addTo(mapRef.current);

        rdLayerRef.current = L.layerGroup().addTo(mapRef.current);
        setTimeout(() => mapRef.current?.invalidateSize(), 0);
      } catch (err) {
        console.error("[RD] Map init error", err);
      }
    };

    initMap();

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      rdLayerRef.current = null;
    };
  }, [viewMode]);

  useEffect(() => {
    if (!mapRef.current || !rdLayerRef.current) return;

    rdLayerRef.current.clearLayers();

    const badRd = detectedRD.find(
      (rd: any) =>
        !rd?.location ||
        !Number.isFinite(Number(rd.location[0])) ||
        !Number.isFinite(Number(rd.location[1]))
    );
    if (badRd) {
      console.warn("[RD] Bad detectedRD entry (location):", badRd);
    }

    const bounds = L.latLngBounds([]);
    detectedRD.forEach((rd: any) => {
      if (!rd?.location) return;
      const [lat, lng] = rd.location;
      const latNum = Number(lat);
      const lngNum = Number(lng);
      const hasValidLocation =
        Number.isFinite(latNum) &&
        Number.isFinite(lngNum) &&
        !(latNum === 0 && lngNum === 0);
      if (!hasValidLocation) return;

      const marker = L.marker([latNum, lngNum], {
        icon: L.icon({
          iconUrl:
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
          shadowUrl:
            "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        }),
      }).bindPopup(`
        <b>Classification:</b> ${rd.classification || "Unknown"}<br/>
        <b>Timestamp:</b> ${rd.timestamp || "N/A"}
      `);

      rdLayerRef.current?.addLayer(marker);
      bounds.extend([latNum, lngNum]);
    });

    // if (bounds.isValid()) {
      // mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    // }
  }, [detectedRD, viewMode]);

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

          <Button
            onClick={() => setViewMode(viewMode === "video" ? "map" : "video")}
            variant="outline"
            className="w-full"
          >
            {viewMode === "video" ? (
              <><Map className="mr-2 h-4 w-4"/> Map View</>
            ) : (
              <><Video className="mr-2 h-4 w-4"/> Video View</>
            )}
          </Button>
          
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
            
            {isConnected ? (
              <Button onClick={disconnect_client} variant="outline" className="w-full">
                <Wifi className="mr-2 h-4 w-4"/> Disconnect
              </Button>
            ) : (
              <Button onClick={connect_client} variant="outline" className="w-full">
                <Wifi className="mr-2 h-4 w-4"/> Connect
              </Button>
            )}
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
                    <span>
                      {rd.location &&
                      Number.isFinite(Number(rd.location[0])) &&
                      Number.isFinite(Number(rd.location[1]))
                        ? `[${Number(rd.location[0]).toFixed(5)}, ${Number(rd.location[1]).toFixed(5)}]`
                        : 'N/A'}
                    </span>
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
        {viewMode === "video" && (
          <>
            {imgUrl ? (
              <img src={imgUrl} className="w-full h-full object-contain" alt="Live Stream" />
            ) : (
              <div className="text-white/30 flex flex-col items-center">
                <Wifi className="w-16 h-16 mb-4 opacity-20"/>
                <p>Waiting for video stream...</p>
              </div>
            )}
          </>
        )}

        {viewMode === "map" && (
          <>
            <div id="detection-map" className="h-full w-full z-0" />
            <div className="absolute bottom-4 right-4 z-20 w-64 h-36 bg-black/80 border border-white/10 rounded-lg overflow-hidden shadow-lg">
              {imgUrl ? (
                <img src={imgUrl} className="w-full h-full object-contain" alt="Live Stream" />
              ) : (
                <div className="text-white/30 flex flex-col items-center justify-center h-full text-xs">
                  <Wifi className="w-6 h-6 mb-2 opacity-30"/>
                  <p>No video</p>
                </div>
              )}
            </div>
          </>
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
