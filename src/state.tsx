import { atom } from "jotai";
import { loadable } from "jotai/utils";
import { createStore } from 'jotai/vanilla'


// atom for detect page detected potholes (array of potholes)
// derived atom for total detected?
// derived atom for latest image of detected pothole
// 
// there should be an electron callback event that sends the
// new detected potholes to the renderer, this function will
// update the detected potholes atom



export interface RD{
  id: string;
  location: [number, number];
  timestamp: string;
  classification: string;
  mainImageUrl: string;
  mainImageBoundingBox: string;
  croppedImageUrl: string;
  fixed: boolean;
  archived: boolean;
}

export interface Session{
  id: string;
  timestamp: string;
  start_location: [number, number];
  end_location: [number, number];
}

export interface ReportsData {
  sessions: any[];
  allDefects: any[];
}

const createRD = (
  id: string,
  location: [number, number],
  timestamp: string,
  classification: string,
  mainImageUrl: string,
  mainImageBoundingBox: string,
  croppedImageUrl: string,
  fixed: boolean,
  archived: boolean,
): RD => ({
  id,
  location,
  timestamp,
  classification,
  mainImageUrl,
  mainImageBoundingBox,
  croppedImageUrl,
  fixed,
  archived
})

export const detected_RD_Atom = atom<RD[]>([])
export const totalDetected_RD_Atom = atom((get) => get(detected_RD_Atom)?.length)
export const latestDetected_RD_Atom = atom(
  (get) => {
    const list = get(detected_RD_Atom);
    return list.length > 0 ? list[list.length - 1] : undefined;
  }
)
export const defectsRefreshAtom = atom(0);

// Recent Sessions (paginated)
// potholes for selected session
// 
// Filtered Potholes (paginated)
// getter -> 
// 
// atom store to update the filtered session
// 

//Update Recent Sessions Atom to fetch from DB
export const recentSessionsAtom = atom(async () => {
  try {
    if (!window.database) return [];
    
    const dbSessions = await window.database.getSessions();
    
    // --- UPDATE THIS MAPPING ---
    return dbSessions.map((s: any) => ({
      id: `session-${s.session_id}`,
      timestamp: s.timestamp,
      start_location: [s.start_lat, s.start_lng],
      end_location: [s.end_lat, s.end_lng],
    })) as Session[];

  } catch (error) {
    console.error("Error loading sessions:", error);
    return [];
  }
});

export const selectedSessionID = atom("")

export const selectedSession = atom(
  async (get) => {
    const sessions = await get(recentSessionsAtom)
    const id = get(selectedSessionID)
    return sessions.find((s) => s.id === id) ?? null
  }
)

//Update Selected Session Defects Atom
export const selectedSession_RD_Atom = atom(async (get) => {
  get(defectsRefreshAtom);
  const idStr = get(selectedSessionID);
  
  // para session-1 ganon itsura nya
  const numericId = parseInt(idStr.replace(/\D/g, ''), 10);
  
  if (isNaN(numericId) || idStr === "") return [];

  try {
    const dbResult = await window.database.getRoadDefectsBySession(numericId);

    // Map DB result to your Interface
    return dbResult.map((row: any) => createRD(
      row.road_defects_id.toString(),
      [row.ave_lat, row.ave_lng],
      "2025-01-01",
      row.ave_classification,
      row.thumbnail_path || "",
      "",
      row.thumbnail_path || "",
      row.is_fixed === 1,
      row.is_archived === 1
    ));
  } catch (error) {
    console.error("Error loading defects:", error);
    return [];
  }
});

export const selectedSession_RD_loadable = loadable(selectedSession_RD_Atom)


export interface SearchParams{
  param1: string;
}

export const createSearchParams = (param1: string): SearchParams => ({param1})

export const currentSearchParamsAtom = atom<SearchParams | null>(null)
export const setSearchParamsAtom = atom(
  null,
  (get, set, next: SearchParams) => {
    const prev = get(currentSearchParamsAtom)
    if(prev?.param1 === next.param1) return
    set(currentSearchParamsAtom, next)
  }
)
export const searchResultsAtom = atom(
  async (get) => {
    const searchParam = get(currentSearchParamsAtom)
    if(searchParam === null){
      return []
    }
    
    try{
      // fetch stuff
      
      // test data
      return [
        createRD("", [0, 0], "", "", "", "", "", false, false),
        createRD("", [0, 0], "", "", "", "", "", false, false),
        createRD("", [0, 0], "", "", "", "", "", false, false),
        createRD("", [0, 0], "", "", "", "", "", false, false),
      ]
    } catch (e) {
      // throw new 
    }

  }
)
export const searchResultsLoadable = loadable(searchResultsAtom)

export const store = createStore()

export const imgUrlAtom = atom('')
const detectedRdInitializedAtom = atom(false)

export function setDetectionImageFrame(buffer: Buffer){
  if(buffer) {
    const previousURL = store.get(imgUrlAtom);
    if (previousURL !== ''){
      URL.revokeObjectURL(previousURL)
    }
    
    const blob = new Blob([buffer as BlobPart], { type:'image/jpg' })
    store.set(imgUrlAtom, URL.createObjectURL(blob));
  }
}

export function initDetectedRdListener() {
  if (store.get(detectedRdInitializedAtom)) return;
  store.set(detectedRdInitializedAtom, true);

  const sanitizeExisting = () => {
    const current = store.get(detected_RD_Atom);
    const sanitized = current.filter((rd) => {
      if (!rd || !Array.isArray(rd.location) || rd.location.length < 2) return false;
      return Number.isFinite(Number(rd.location[0])) && Number.isFinite(Number(rd.location[1]));
    });
    if (sanitized.length !== current.length) {
      store.set(detected_RD_Atom, sanitized);
    }
  };

  sanitizeExisting();

  if (!window?.rasp_connection?.onInferenceData) return;

  window.rasp_connection.onInferenceData((data: any[]) => {
    if (!Array.isArray(data) || data.length === 0) return;
    const badPayload = data.find(
      (d) =>
        !Number.isFinite(Number(d?.lat)) || !Number.isFinite(Number(d?.lng))
    );
    if (badPayload) {
      console.warn("[RD] Bad inference payload (lat/lng):", badPayload);
    }
    const current = store.get(detected_RD_Atom);
    const byId = new Map(current.map((rd) => [rd.id, rd]));
    const next = [...current];
    let changed = false;

    data
      .filter((d) => d && d.id !== undefined && d.id !== null)
      .forEach((d) => {
        const id = String(d.id ?? "");
        if (!id) return;
        const location =
          (Number.isFinite(d.lat) && Number.isFinite(d.lng))
            ? [d.lat, d.lng] as [number, number]
            : null;
        const timestamp =
          typeof d.timestamp === "string" ? d.timestamp : new Date().toISOString();

        const existing = byId.get(id);
        if (existing) {
          if (location && existing.location[0] === 0 && existing.location[1] === 0) {
            existing.location = location;
            existing.timestamp = timestamp;
            if (d.class !== undefined && d.class !== null) {
              existing.classification = String(d.class);
            }
            changed = true;
          }
          return;
        }

        next.push(createRD(
          id,
          location ?? [0, 0],
          timestamp,
          String(d.class ?? ""),
          "",
          JSON.stringify(d.box ?? []),
          "",
          false,
          false
        ));
        changed = true;
      });

    if (changed) {
      store.set(detected_RD_Atom, next);
    }
  });
}

export function clearDetectedRD() {
  store.set(detected_RD_Atom, []);
}

export const reportsAtom = atom(async (get) => {
  get(defectsRefreshAtom); 

  try {
    if (!window.database) return { sessions: [], allDefects: [] };

    const rawSessions = await window.database.getSessions();
    const defectPromises = rawSessions.map((s: any) => 
      window.database.getRoadDefectsBySession(s.session_id)
    );
    
    const defectsArrays = await Promise.all(defectPromises);
    const allDefects = defectsArrays.flat();

    return { 
      sessions: rawSessions, 
      allDefects: allDefects 
    };

  } catch (error) {
    console.error("Error loading reports:", error);
    return { sessions: [], allDefects: [] };
  }
});

export const reportsLoadable = loadable(reportsAtom);
export const recentSessionsLoadable = loadable(recentSessionsAtom);
export const selectedSessionLoadable = loadable(selectedSession);

initDetectedRdListener();
