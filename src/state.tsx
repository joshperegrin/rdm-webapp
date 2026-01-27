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

// Recent Sessions (paginated)
// potholes for selected session
// 
// Filtered Potholes (paginated)
// getter -> 
// 
// atom store to update the filtered session
// 

export const recentSessionsAtom = atom<Session[]>([
  {
    id: "session-001",
    timestamp: "2025-01-10 08:30",
    start_location: [14.444134, 120.953242],
    end_location: [14.4455, 120.9548],
  },
  {
    id: "session-002",
    timestamp: "2025-01-11 09:15",
    start_location: [14.4400, 120.9500],
    end_location: [14.4480, 120.9600],
  },
])

export const selectedSessionID = atom("")

export const selectedSession = atom(
  (get) => {
    const sessions = get(recentSessionsAtom)
    const id = get(selectedSessionID)
    return sessions.find((s) => s.id === id) ?? null
  }
)
export const selectedSession_RD_Atom = atom(
  async (get) => {
    const id = get(selectedSessionID)
    if(id === ""){
      return []
    } 

    // test data per session
    if(id === "session-001") {
      return [
        createRD("TUP", [14.4445, 120.9548], "2025-01-10 08:45", "Pothole", "", "", "", false, false),
        createRD("TUP-2", [14.4448, 120.9550], "2025-01-10 08:50", "Crack", "", "", "", true, false),
      ]
    } else if(id === "session-002") {
      return [
        createRD("TUP-3", [14.4410, 120.9510], "2025-01-11 09:30", "Pothole", "", "", "", false, false),
      ]
    } else {
      return []
    }
  }
)

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

export function setDetectionImageFrame(buffer: Buffer){
  if(buffer) {
    const previousURL = store.get(imgUrlAtom);
    if (previousURL === ''){
      URL.revokeObjectURL(previousURL)
    }
    
    const blob = new Blob([buffer as BlobPart], { type:'image/jpg' })
    store.set(imgUrlAtom, URL.createObjectURL(blob));
  }
}