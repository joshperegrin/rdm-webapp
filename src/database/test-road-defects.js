import { getListOfSessions, getSessionWithRoadDefects } from './road.defect.model.js';

console.log("=== All Sessions ===");
console.log(getListOfSessions());

console.log("\n=== Session 1 Details ===");
console.log(getSessionWithRoadDefects(1));
