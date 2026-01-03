
import { atom } from "jotai";
import { loadable } from "jotai/utils";


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

export const recentSessionsAtom = atom<Session[]>([])
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

    // fetch stuff
    
    // test data
    return [
      createRD("", [0, 0], "", "", "", "", "", false, false),
      createRD("", [0, 0], "", "", "", "", "", false, false),
      createRD("", [0, 0], "", "", "", "", "", false, false),
      createRD("", [0, 0], "", "", "", "", "", false, false),
    ] 
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
