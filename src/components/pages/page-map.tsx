import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAtom } from "jotai";
import * as protomapsL from "protomaps-leaflet";
import { Compression, type DecompressFunc, PMTiles } from "pmtiles";
import { ZstdCodec } from "zstd-codec";

import {
  recentSessionsLoadable, // loadable version
  selectedSessionID,
  selectedSessionLoadable, // loadable version
  selectedSession_RD_loadable,
  defectsRefreshAtom,
  Session,
} from "@/state";

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

function MapPage() {
  //Use the loadable atoms instead of the raw async atoms
  const [sessionsValue] = useAtom(recentSessionsLoadable);
  const [, setSelectedSessionID] = useAtom(selectedSessionID);
  const [sessionValue] = useAtom(selectedSessionLoadable);
  const [rdLoadable] = useAtom(selectedSession_RD_loadable);

  const sessions = sessionsValue.state === 'hasData' ? sessionsValue.data : [];
  const session = sessionValue.state === 'hasData' ? sessionValue.data : null;

  const mapRef = useRef<L.Map | null>(null);
  const rdLayerRef = useRef<L.LayerGroup | null>(null);
  const rdMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const pmtilesRef = useRef<PMTiles | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "archive">("active");
  const [, triggerRefresh] = useAtom(defectsRefreshAtom);
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const defectRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const PMTILES_URL = "pmtiles://philippines.pmtiles";

/* Inside MapPage component */

type RoadDefect = {
  id: string | number;
  classification?: string;
  location: [number, number];
  fixed: boolean;
  archived?: boolean;
  mainImageUrl?: string;
};

const markRoadDefectFixed = async (rdId: string | number) => {
  try {
    const marker = rdMarkersRef.current.get(rdId.toString());
    if (marker) {
      marker.setIcon(
        L.icon({
          iconUrl:
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png",
          shadowUrl:
            "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        })
      );
    }

    await window.database.markFixed(Number(rdId));
    triggerRefresh((prev) => prev + 1);

  } catch (e) {
    console.error(e);
  }
};


const archiveRoadDefect = async (rdId: string | number) => {
  try {
    const marker = rdMarkersRef.current.get(rdId.toString());
    if (marker) {
      marker.setIcon(
        L.icon({
          iconUrl:
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png",
          shadowUrl:
            "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        })
      );
    }

    await window.database.archive(Number(rdId));
    triggerRefresh((prev) => prev + 1);
  } catch (e) {
    console.error(e);
  }
};


  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map("map").setView([12.8797, 121.7740], 6);

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

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      rdLayerRef.current = null;
      rdMarkersRef.current.clear();
    };
  }, []);

  /* markers */
  useEffect(() => {
    if (!mapRef.current || !rdLayerRef.current) return;

    rdLayerRef.current.clearLayers();
    rdMarkersRef.current.clear();

    let rdList: any[] = [];

    if (rdLoadable.state === "hasData") {
      rdList = rdLoadable.data;
    }

    if (!session) {
      sessions.forEach((s: any) => {
        if (s.road_defects) {
          rdList.push(...s.road_defects);
        }
      });
    }

    if (rdList.length === 0) return;

    const bounds = L.latLngBounds([]);

    rdList.forEach((rd) => {
      const [lat, lng] = rd.location;

      if (lat === 0 || lng === 0 || Number.isNaN(lat) || Number.isNaN(lng)) return;

      const marker = L.marker([lat, lng], {
        icon: L.icon({
          iconUrl:
            rd.archived
              ? "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-grey.png"
              : rd.fixed
              ? "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png"
              : "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
          shadowUrl:
            "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        }),
      }).bindPopup(`
        <b>Classification:</b> ${rd.classification || "Unknown"}<br/>
        <b>Timestamp:</b> ${rd.timestamp || "N/A"}<br/>
        <b>Status:</b> ${rd.fixed ? "Fixed" : "Unfixed"}
      `);

      rdLayerRef.current?.addLayer(marker);
      rdMarkersRef.current.set(rd.id, marker);
      marker.on("click", () => {
        const id = rd.id.toString();
        setSelectedDefectId(id);

        const element = defectRefs.current.get(id);
        if (element) {
          element.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      });


      bounds.extend([lat, lng]);
    });

    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [rdLoadable]);

  return (
    <div className="flex h-full w-full">

      {/* Select Session */}
      <div className="hidden md:flex md:w-1/4 lg:w-80 flex-col bg-slate-800 p-4 text-white">
        <h2 className="font-semibold mb-4">Sessions</h2>

        <div className="flex flex-col gap-2 overflow-y-auto">
          {sessions.length === 0 && (
            <p className="text-slate-400">No sessions available</p>
          )}

          {sessions.map((s: Session) => (
            <button
              key={s.id}
              onClick={() => setSelectedSessionID(s.id)}
              className="w-full text-left p-2 rounded bg-slate-700 hover:bg-slate-600 transition"
            >
              <div className="text-sm font-medium">{s.id}</div>
              <div className="text-xs text-slate-300">{s.timestamp}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Map */}
      <div className="flex-1 bg-slate-900">
        <div id="map" className="h-full w-full" />
      </div>

      {/* Session Details */}
      <div className="hidden md:flex md:w-1/4 lg:w-80 flex-col bg-slate-800 p-4 text-white">
        <h2 className="font-semibold mb-4">Session Details</h2>

        {session ? (
          <div className="space-y-4 text-sm">
            <div><b>ID:</b> {session.id}</div>
            <div><b>Started:</b> {session.timestamp}</div>
            <div>
              <b>Start:</b> {session.start_location[0]}, {session.start_location[1]}
            </div>
            <div>
              <b>End:</b> {session.end_location[0]}, {session.end_location[1]}
            </div>

            <hr className="border-slate-600" />

            <div>
      <b>Detected Road Defects:</b>
        </div>

        {/* Tabs */}
        <div className="flex mt-2 border-b border-slate-600">
          <button
            className={`px-3 py-1 text-xs ${
              activeTab === "active"
                ? "border-b-2 border-blue-400 text-blue-400"
                : "text-slate-400"
            }`}
            onClick={() => setActiveTab("active")}
          >
            Active
          </button>

          <button
            className={`px-3 py-1 text-xs ${
              activeTab === "archive"
                ? "border-b-2 border-blue-400 text-blue-400"
                : "text-slate-400"
            }`}
            onClick={() => setActiveTab("archive")}
          >
            Archive
          </button>
        </div>

            {rdLoadable.state === "loading" && (
              <p className="text-slate-400">Loading defects…</p>
            )}

            {rdLoadable.state === "hasData" &&
              rdLoadable.data.length === 0 && (
                <p className="text-slate-400">No defects detected</p>
              )}

            {rdLoadable.state === "hasData" && (
              <ul className="space-y-1 max-h-120 overflow-y-auto">
                {rdLoadable.data
                  .filter((rd: RoadDefect) =>
                    activeTab === "active"
                      ? !rd.archived
                      : rd.archived
                  )
                  .map((rd: RoadDefect, idx: number) => {
                    return (
                      <li
                        key={idx}
                        ref={(el) => {
                          if (el) defectRefs.current.set(rd.id.toString(), el);
                        }}
                        className={`p-2 rounded text-xs cursor-pointer transition ${
                          selectedDefectId === rd.id.toString()
                            ? "bg-blue-600"
                            : "bg-slate-700 hover:bg-slate-600"
                        }`}
                        onClick={() => {
                          const marker = rdMarkersRef.current.get(rd.id.toString());
                          if (marker) {
                            marker.openPopup();
                            mapRef.current?.panTo(marker.getLatLng());
                          }
                        }}
                      >
                        <div><b>Type:</b> {rd.classification || "Unknown"}</div>
                        <div><b>Location:</b> {rd.location[0]}, {rd.location[1]}</div>
                        <div><b>Status:</b> {rd.fixed ? "Fixed" : "Unfixed"}</div>
                        <div><b>Image:</b> {rd.mainImageUrl}</div>

                      {/* Archive & Fixed buttons */}

                      <div className="flex gap-2 mt-1">

                        {!rd.fixed && (
                          <button
                            className="px-2 py-1 text-xs bg-green-600 rounded hover:bg-green-500"
                            onClick={() => markRoadDefectFixed(rd.id)}
                          >
                            Mark Fixed
                          </button>
                        )}
                        {!rd.archived && (
                          <button
                            className="px-2 py-1 text-xs bg-red-600 rounded hover:bg-red-500"
                            onClick={() => archiveRoadDefect(rd.id)}
                          >
                            Archive
                          </button>
                        )}

                      </div>

                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-slate-400">Select a session from the left</p>
        )}
      </div>

    </div>
  );
}

export default MapPage;
