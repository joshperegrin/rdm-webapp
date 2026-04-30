import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAtom } from "jotai";
import * as protomapsL from "protomaps-leaflet";
import { Compression, type DecompressFunc, PMTiles } from "pmtiles";
import { ZstdCodec } from "zstd-codec";
import { MapPin, Activity, Clock, Map as MapIcon, X, ZoomIn } from "lucide-react";

import {
  recentSessionsLoadable,
  selectedSessionID,
  selectedSessionLoadable,
  selectedSession_RD_loadable,
  defectsRefreshAtom,
  loadedSessionsAtom,
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
    if (!stream) throw new Error("Failed to read compressed tile stream.");
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

type RoadDefect = {
  id: string | number;
  classification?: string;
  location: [number, number];
  fixed: boolean;
  archived: boolean;
  mainImageUrl?: string;
};

const CLASS_COLORS: { label: string; color: string }[] = [
  { label: "Longitudinal Crack", color: "#dc2626" },
  { label: "Transverse Crack", color: "#ea580c" },
  { label: "Alligator Crack", color: "#7c3aed" },
  { label: "Pothole", color: "#2563eb" },
  { label: "Patchy Road", color: "#d97706" },
];

const NEUTRAL_COLOR = "#6b7280";

const colorForDefect = (rd: { classification?: string; fixed?: boolean; archived?: boolean }) => {
  if (rd.archived || rd.fixed) return NEUTRAL_COLOR;
  const match = CLASS_COLORS.find((c) => c.label === rd.classification);
  return match ? match.color : NEUTRAL_COLOR;
};

const buildIcon = (color: string) =>
  L.divIcon({
    className: "rdm-defect-pin",
    html: `
      <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
        <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z"
              fill="${color}" stroke="#1f2937" stroke-width="1"/>
        <circle cx="12.5" cy="12.5" r="5" fill="#ffffff"/>
      </svg>
    `,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });

const isValidCoord = (lat: any, lng: any): boolean =>
  lat != null && lng != null &&
  !Number.isNaN(lat) && !Number.isNaN(lng) &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  !(lat === 0 && lng === 0);

function MapPage() {
  const [sessionsValue] = useAtom(recentSessionsLoadable);
  const [currentSessionID, setSelectedSessionID] = useAtom(selectedSessionID);
  const [, setLoadedSessions] = useAtom(loadedSessionsAtom);
  const [sessionValue] = useAtom(selectedSessionLoadable);
  const [rdLoadable] = useAtom(selectedSession_RD_loadable);

  const sessions = sessionsValue.state === "hasData" ? sessionsValue.data : [];

  useEffect(() => {
    if (sessionsValue.state === "hasData") {
      setLoadedSessions(sessionsValue.data);
    }
  }, [sessionsValue]);

  const session = sessionValue.state === "hasData" ? sessionValue.data : null;

  const mapRef = useRef<L.Map | null>(null);
  const rdLayerRef = useRef<L.LayerGroup | null>(null);
  const rdMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const pmtilesRef = useRef<PMTiles | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "archive">("active");
  const [, triggerRefresh] = useAtom(defectsRefreshAtom);
  const [selectedDefectId, setSelectedDefectId] = useState<string | null>(null);
  const defectRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  // ── Lightbox state ──
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const PMTILES_URL = "pmtiles://philippines.pmtiles";

  const markRoadDefectFixed = async (rdId: string | number) => {
    try {
      rdMarkersRef.current.get(rdId.toString())?.setIcon(buildIcon(NEUTRAL_COLOR));
      const result = await window.database.markFixed(Number(rdId));
      console.log("markFixed result:", result);
      triggerRefresh((prev) => prev + 1);
    } catch (e) {
      console.error("markFixed error:", e);
    }
  };

  const archiveRoadDefect = async (rdId: string | number) => {
    try {
      rdMarkersRef.current.get(rdId.toString())?.setIcon(buildIcon(NEUTRAL_COLOR));
      await window.database.archive(Number(rdId));
      triggerRefresh((prev) => prev + 1);
    } catch (e) {
      console.error(e);
    }
  };

  /* Initialize map once on mount */
  useEffect(() => {
    const container = document.getElementById("map");
    if (!container || mapRef.current) return;

    (container as any)._leaflet_id = undefined;
    mapRef.current = L.map(container).setView([12.8797, 121.774], 6);

    if (!pmtilesRef.current) {
      pmtilesRef.current = new PMTiles(PMTILES_URL, undefined, decompressPMTiles);
    }

    protomapsL
      .leafletLayer({ url: pmtilesRef.current, flavor: "light", lang: "en" })
      .addTo(mapRef.current);

    rdLayerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        rdLayerRef.current = null;
        rdMarkersRef.current.clear();
      }
    };
  }, []);

  /* Update markers when session/data changes */
  useEffect(() => {
    if (!mapRef.current || !rdLayerRef.current) return;

    rdLayerRef.current.clearLayers();
    rdMarkersRef.current.clear();

    let rdList: any[] = [];
    if (rdLoadable.state === "hasData") rdList = rdLoadable.data;

    if (!session) {
      sessions.forEach((s: any) => {
        if (s.road_defects) rdList.push(...s.road_defects);
      });
    }

    if (rdList.length === 0) return;

    const bounds = L.latLngBounds([]);

    rdList.forEach((rd) => {
      if (!rd?.location) return;
      const [lat, lng] = rd.location;
      if (!isValidCoord(lat, lng)) return;

      const marker = L.marker([lat, lng], {
        icon: buildIcon(colorForDefect(rd)),
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
        defectRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      bounds.extend([lat, lng]);
    });

    if (!bounds.isValid() || !mapRef.current) return;

    const map = mapRef.current;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    if (ne.lat === sw.lat && ne.lng === sw.lng) {
      map.flyTo([ne.lat, ne.lng], 15, { animate: true, duration: 1 });
    } else {
      map.flyToBounds(bounds, { padding: [50, 50], animate: true, duration: 1 });
    }
  }, [rdLoadable, session]);

  const displayedDefects =
    rdLoadable.state === "hasData"
      ? rdLoadable.data.filter((rd: RoadDefect) =>
          activeTab === "active" ? !rd.archived : rd.archived
        )
      : [];

  return (
    <div className="flex flex-row h-full w-full bg-slate-50 dark:bg-slate-900 p-4 gap-4 overflow-hidden">

      {/* ── Lightbox Modal ── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative"
            style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              className="absolute -top-3 -right-3 z-10 bg-white dark:bg-slate-700 rounded-full p-1.5 shadow-lg hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
              onClick={() => setLightboxUrl(null)}
            >
              <X className="w-4 h-4 text-slate-700 dark:text-slate-200" />
            </button>

            {/* Image */}
            <img
              src={lightboxUrl}
              alt="Defect Image"
              style={{ maxWidth: '90vw', maxHeight: '90vh', width: 'auto', height: 'auto', minWidth: '400px', minHeight: '300px' }}
              className="rounded-xl shadow-2xl border border-white/10 block"
            />
          </div>
        </div>
      )}

      {/* ── Left Panel: Sessions ── */}
      <div className="flex flex-col w-full md:w-1/3 lg:w-1/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">

        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <MapIcon className="w-5 h-5 text-blue-500" />
            Sessions
          </h2>
        </div>

        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Session Log</span>
          <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full text-xs">
            {sessions.length} Total
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
              <MapIcon className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm">No sessions available.</p>
              <p className="text-xs">Start a detection session to see data.</p>
            </div>
          ) : (
            sessions.map((s: Session) => (
              <button
                key={s.id}
                onClick={() => setSelectedSessionID(s.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  currentSessionID === s.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{s.id}</div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  <Clock className="w-3 h-3" />
                  <span>{s.timestamp}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Center Panel: Map ── */}
      <div className="flex-1 rounded-xl shadow-sm overflow-hidden border border-slate-200 dark:border-slate-700 relative">
        <div id="map" className="h-full w-full z-0" />

        {/* Legend */}
        <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 dark:bg-slate-800/95 text-slate-700 dark:text-slate-200 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3 text-xs">
          <div className="font-semibold mb-2 text-slate-800 dark:text-slate-100">Legend</div>
          <ul className="space-y-1.5">
            {CLASS_COLORS.map(({ label, color }) => (
              <li key={label} className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full border border-slate-700"
                  style={{ backgroundColor: color }}
                />
                <span>{label}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-1.5 border-t border-slate-200 dark:border-slate-700">
              <span
                className="inline-block w-3 h-3 rounded-full border border-slate-700"
                style={{ backgroundColor: NEUTRAL_COLOR }}
              />
              <span>Fixed / Archived / Unknown</span>
            </li>
          </ul>
        </div>
      </div>

      {/* ── Right Panel: Session Details ── */}
      <div className="flex flex-col w-full md:w-1/3 lg:w-1/4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">

        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <Activity className="w-5 h-5 text-blue-500" />
            Session Details
          </h2>
        </div>

        {session ? (
          <>
            {/* Meta */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">ID</span>
                <span className="font-medium text-slate-700 dark:text-slate-200">{session.id}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-slate-500 dark:text-slate-400">Started</span>
                <span className="font-medium text-slate-700 dark:text-slate-200 text-xs text-right">{session.timestamp}</span>
              </div>
              <div className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400 pt-1">
                <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                <span>Start: {session.start_location[0]}, {session.start_location[1]}</span>
              </div>
              <div className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                <span>End: {session.end_location[0]}, {session.end_location[1]}</span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-700">
              {(["active", "archive"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`flex-1 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    activeTab === tab
                      ? "border-b-2 border-blue-500 text-blue-500"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Defect count badge */}
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Defects</span>
              <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full text-xs">
                {rdLoadable.state === "hasData" ? displayedDefects.length : "—"} Total
              </span>
            </div>

            {/* Defects list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {rdLoadable.state === "loading" && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                  <Activity className="w-12 h-12 mb-2 opacity-20 animate-pulse" />
                  <p className="text-sm">Loading defects…</p>
                </div>
              )}

              {rdLoadable.state === "hasData" && displayedDefects.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
                  <Activity className="w-12 h-12 mb-2 opacity-20" />
                  <p className="text-sm">No defects here.</p>
                  <p className="text-xs">
                    {activeTab === "active" ? "All clear or check Archive." : "No archived defects yet."}
                  </p>
                </div>
              )}

              {rdLoadable.state === "hasData" &&
                displayedDefects.map((rd: RoadDefect, idx: number) => (
                  <li
                    key={idx}
                    ref={(el) => { if (el) defectRefs.current.set(rd.id.toString(), el as HTMLLIElement); }}
                    style={{ listStyleType: "none" }}
                    className={`p-3 rounded-lg border text-xs cursor-pointer transition-colors ${
                      selectedDefectId === rd.id.toString()
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700"
                    }`}
                    onClick={() => {
                      const id = rd.id.toString();
                      setSelectedDefectId(id);
                      const marker = rdMarkersRef.current.get(id);
                      if (marker) {
                        marker.openPopup();
                        mapRef.current?.panTo(marker.getLatLng());
                      }
                    }}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">ID: {rd.id}</span>
                      <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-xs">
                        Class {rd.classification || "Unknown"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-1 text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span>{Number(rd.location[0]).toFixed(5)}, {Number(rd.location[1]).toFixed(5)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3 h-3 shrink-0" />
                        <span>{rd.fixed ? "Fixed" : "Unfixed"}</span>
                      </div>
                    </div>

                    {/* ── Image preview button ── */}
                    {rd.mainImageUrl && (
                      <button
                        className="mt-2 w-full flex items-center gap-1.5 text-blue-500 hover:text-blue-400 transition-colors text-xs group"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxUrl(rd.mainImageUrl!);
                        }}
                      >
                        <ZoomIn className="w-3 h-3 shrink-0 group-hover:scale-110 transition-transform" />
                        <span className="underline underline-offset-2">View Photo</span>
                      </button>
                    )}

                    <div className="flex gap-2 mt-2">
                      {!rd.fixed && (
                        <button
                          className="px-2 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-500 text-white transition-colors"
                          onClick={(e) => { e.stopPropagation(); markRoadDefectFixed(rd.id); }}
                        >
                          Mark Fixed
                        </button>
                      )}
                      {!rd.archived && (
                        <button
                          className="px-2 py-1 text-xs font-medium rounded bg-red-500 hover:bg-red-400 text-white transition-colors"
                          onClick={(e) => { e.stopPropagation(); archiveRoadDefect(rd.id); }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </li>
                ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
            <MapIcon className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">No session selected.</p>
            <p className="text-xs">Pick a session from the left panel.</p>
          </div>
        )}
      </div>

    </div>
  );
}

export default MapPage;