export const logged = [];
export async function logStaff(staff, action, target, detail, undo) { logged.push({ action, target, detail, undo }); return "audit-" + logged.length; }
export async function applyEnforcement() {}
