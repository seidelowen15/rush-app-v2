// Check-ins that could not reach the database are kept on this device and
// retried until they go through. Stored in localStorage so a reload, a closed
// tab or a sleeping laptop does not lose them. Clearing the browser's site
// data (or losing the laptop) does.

const KEY = "kiosk_pending_checkins_v1";

// A request that never reached the server (no Postgres error code).
export function isNetworkError(e) {
  if (!e) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e.code) return false;
  const msg = String(e.message || e);
  return /failed to fetch|networkerror|network request failed|load failed|fetch|timed? ?out/i.test(msg);
}

export function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

// Returns false if the device refused to store it (private window, full disk);
// the caller must then NOT tell the candidate they are checked in.
export function writeQueue(q) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
    return true;
  } catch (e) {
    console.error("offline queue write failed", e);
    return false;
  }
}

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

// Loose key for "same person typed twice while offline".
export function idKey(raw) {
  return String(raw || "")
    .toLowerCase()
    .split("@")[0]
    .replace(/[^a-z0-9]/g, "");
}

export function enqueue(item) {
  const q = readQueue();
  q.push({
    qid: newId(),
    signed_in_at: new Date().toISOString(),
    attempts: 0,
    status: "pending", // pending | failed | skipped
    ...item,
  });
  return writeQueue(q);
}

export function isQueued(eventId, { pnmId, rawId }) {
  const k = idKey(rawId);
  return readQueue().some(
    (it) =>
      it.event_id === eventId &&
      it.status !== "skipped" &&
      ((pnmId && it.pnm_id === pnmId) || (k && idKey(it.person?.psu_id) === k)),
  );
}

export function updateItem(qid, patch) {
  const q = readQueue().map((it) => (it.qid === qid ? { ...it, ...patch } : it));
  writeQueue(q);
}

export function removeItem(qid) {
  writeQueue(readQueue().filter((it) => it.qid !== qid));
}
