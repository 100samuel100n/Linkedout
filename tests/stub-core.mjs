import { alerts } from "./stub-db.mjs";
export const raiseAlert = async (a) => { alerts.push(a); return { id: "x" }; };
