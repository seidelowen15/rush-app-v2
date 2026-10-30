import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { BRAND } from "../lib/brand";
import { levenshtein } from "../lib/utils";
import {
  isNetworkError,
  readQueue,
  enqueue,
  isQueued,
  updateItem,
  removeItem,
} from "../lib/offlineQueue";
import {
  getEventId,
  getEventLabel,
  getStationId,
  getSide,
} from "../components/AuthGate";
import StationControls from "../components/StationControls";
import "../queue.css";
import "../kiosk.css";

const YEARS = ["Freshman", "Sophomore", "Junior", "Senior"];
const MAJORS = [
  "Accounting",
  "Actuarial Science",
  "Advertising/PR",
  "Aerospace Engineering",
  "African American Studies",
  "Agricultural Science",
  "Architecture",
  "Art",
  "Biochemistry",
  "Biology",
  "Biomedical Engineering",
  "Business",
  "Chemical Engineering",
  "Chemistry",
  "Civil Engineering",
  "Communications",
  "Computer Engineering",
  "Computer Science",
  "Criminal Justice",
  "Economics",
  "Education",
  "Electrical Engineering",
  "Engineering",
  "English",
  "Environmental Science",
  "Finance",
  "Food Science",
  "Geography",
  "Graphic Design",
  "Health Policy & Administration",
  "History",
  "Hospitality Management",
  "Human Development & Family Studies",
  "Industrial Engineering",
  "Information Sciences & Technology",
  "IST",
  "Kinesiology",
  "Labor & Employment Relations",
  "Landscape Architecture",
  "Marketing",
  "Math",
  "Mechanical Engineering",
  "Media Studies",
  "Meteorology",
  "Music",
  "Nursing",
  "Nutrition",
  "Philosophy",
  "Physics",
  "Political Science",
  "Psychology",
  "Recreation",
  "Security & Risk Analysis",
  "Sociology",
  "Spanish",
  "Supply Chain",
  "Statistics",
  "Theatre",
  "Undecided",
  "Other",
];

export default function Kiosk() {
  const eventId = getEventId();
  const stationId = getStationId();
  const side = getSide();

  // pnm_id values already checked in TO THIS EVENT. Scoped per event, so a
  // returning PNM can check in again on a later night.
  const [attendedIds, setAttendedIds] = useState(new Set());
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [waiting, setWaiting] = useState({ left: 0, right: 0 });

  const [psuId, setPsuId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [year, setYear] = useState("");
  const [major, setMajor] = useState("");
  const [majorSearch, setMajorSearch] = useState("");
  const [showMajorList, setShowMajorList] = useState(false);
  const [majorNote, setMajorNote] = useState(""); // "Corrected to …"
  const [step, setStep] = useState("id");
  const [flash, setFlash] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [idError, setIdError] = useState("");
  const [idWarning, setIdWarning] = useState(false); // soft: unrecognised shape
  const [offline, setOffline] = useState(false); // RPC unreachable this attempt
  const [profileBlock, setProfileBlock] = useState(false); // no rush profile on file
  const [blockSeconds, setBlockSeconds] = useState(10);
  const [canonical, setCanonical] = useState(null);
  const [dupMatches, setDupMatches] = useState([]); // likely existing records
  const [requireProfile, setRequireProfile] = useState(false); // shared setting
  const [settingBusy, setSettingBusy] = useState(false);
  const [settingError, setSettingError] = useState("");
  const [pending, setPending] = useState(() => readQueue()); // offline check-ins
  const [syncing, setSyncing] = useState(false);
  const flushing = useRef(false);
  const [existingPnm, setExistingPnm] = useState(null);
  const [checking, setChecking] = useState(false); // ID lookup in flight
  const [formError, setFormError] = useState("");
  const [stationOpen, setStationOpen] = useState(false);
  const idRef = useRef(null);
  const flashTimer = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!eventId) return;
    load();
    const channel = supabase
      .channel("attendance-kiosk")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance",
          filter: `event_id=eq.${eventId}`,
        },
        () => load(),
      )
      // DELETE events cannot be filtered in Supabase realtime.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "attendance" },
        () => load(),
      )
      // Photo saves write pnms.photo_path; without this the "Waiting for
      // photo" count only moved when someone new signed in.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pnms" },
        () => load(),
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  // Profile-block message clears itself so the next PNM isn't stuck
  // looking at someone else's rejection.
  useEffect(() => {
    if (!profileBlock) return;
    setBlockSeconds(10);
    const tick = setInterval(() => setBlockSeconds((s) => Math.max(0, s - 1)), 1000);
    const t = setTimeout(() => {
      setProfileBlock(false);
      setPsuId("");
      setIdError("");
      setStep("id");
      focusId();
    }, 10000);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [profileBlock]);

  // ── Shared kiosk settings (Require rush profiles) ──
  async function loadSettings() {
    const { data, error } = await supabase.rpc("kiosk_settings");
    if (error) {
      // Offline or not deployed yet: keep the last known value.
      console.error("kiosk_settings failed", error);
      return;
    }
    setRequireProfile(!!data?.require_profile);
  }
  async function toggleRequireProfile(on) {
    setSettingBusy(true);
    setSettingError("");
    const { error } = await supabase.rpc("kiosk_set_require_profile", { p_on: on });
    setSettingBusy(false);
    if (error) {
      setSettingError(
        isNetworkError(error)
          ? "Couldn't reach the server. The setting didn't change."
          : `Couldn't change the setting: ${error.message}`,
      );
      return;
    }
    setRequireProfile(on);
  }

  // ── Offline check-ins: retry until they reach the database ──
  function refreshPending() {
    setPending(readQueue());
  }

  async function syncItem(item) {
    let pnmId = item.pnm_id;
    if (!pnmId) {
      const person = item.person;
      // Checks that were skipped while offline run now.
      const br = await supabase.rpc("kiosk_is_brother", { raw: person.psu_id });
      if (br.error && isNetworkError(br.error)) throw br.error;
      if (!br.error && br.data === true) {
        updateItem(item.qid, { status: "skipped", reason: "Brother ID, not checked in" });
        return;
      }
      let { data: pnm, error } = await supabase
        .from("pnms")
        .insert({
          psu_id: person.psu_id,
          first_name: person.first_name,
          last_name: person.last_name,
          major: person.major,
          year: person.year,
          source_event_id: item.event_id,
        })
        .select("id, psu_id, psu_id_unverified")
        .single();
      if (error && error.code === "23505") {
        const { canon, unreachable } = await canonicalize(person.psu_id);
        if (unreachable) throw new Error("Failed to fetch");
        const res = await supabase
          .from("pnms")
          .select("id, psu_id, psu_id_unverified")
          .eq("psu_id", canon)
          .single();
        if (res.error) throw res.error;
        pnm = res.data;
      } else if (error) {
        if (isNetworkError(error)) throw error;
        updateItem(item.qid, { status: "failed", reason: error.message });
        return;
      }
      pnmId = pnm.id;
      updateItem(item.qid, { pnm_id: pnmId }); // never create them twice
      if (pnm.psu_id_unverified) {
        await supabase.from("pnm_id_reviews").insert({
          pnm_id: pnm.id,
          raw_input: person.psu_id,
          event_id: item.event_id,
        });
      }
      const matches = await findLikelyDuplicates(
        person.first_name,
        person.last_name,
        pnm.psu_id,
      );
      for (const m of matches.filter((x) => x.id !== pnm.id)) {
        await supabase.from("pnm_id_reviews").insert({
          pnm_id: m.id,
          raw_input: m.psu_id,
          event_id: item.event_id,
          note: `Possible duplicate: offline kiosk check-in as ${pnm.psu_id} (${person.first_name} ${person.last_name}). If this is the same person, resolve with ${pnm.psu_id} to merge.`,
        });
      }
    }
    const { error } = await supabase.from("attendance").insert({
      pnm_id: pnmId,
      event_id: item.event_id,
      station_id: item.station_id,
      side: item.side,
      signed_in_at: item.signed_in_at, // keep the real arrival time
    });
    if (error && error.code !== "23505") {
      if (isNetworkError(error)) throw error;
      updateItem(item.qid, { status: "failed", pnm_id: pnmId, reason: error.message });
      return;
    }
    removeItem(item.qid);
  }

  async function flushQueue() {
    if (flushing.current) return;
    const todo = readQueue().filter((it) => it.status === "pending");
    if (!todo.length) return;
    flushing.current = true;
    setSyncing(true);
    try {
      for (const item of todo) {
        try {
          await syncItem(item);
        } catch (e) {
          if (isNetworkError(e)) break; // still offline; try again later
          updateItem(item.qid, { status: "failed", reason: e.message || String(e) });
        }
      }
    } finally {
      flushing.current = false;
      setSyncing(false);
      refreshPending();
      if (eventId) load();
    }
  }

  useEffect(() => {
    loadSettings();
    flushQueue();
    const timer = setInterval(() => {
      loadSettings();
      flushQueue();
    }, 15000);
    const onOnline = () => {
      loadSettings();
      flushQueue();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onOnline);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onOnline);
    };
  }, [eventId]);

  // Save a check-in on this laptop when the database can't be reached.
  // Returns true only if it was really stored.
  function saveOffline(item) {
    const ok = enqueue({ event_id: eventId, station_id: stationId, side, ...item });
    refreshPending();
    return ok;
  }
  // One query drives all three numbers. photo_path lives on pnms (one headshot
  // per person, ever), so "waiting for photo" means attendees at this event who
  // have never been photographed.
  async function load() {
    const { data, error } = await supabase
      .from("attendance")
      .select("pnm_id, side, pnms(photo_path)")
      .eq("event_id", eventId);
    if (error) {
      console.error("load failed", error);
      return;
    }
    const rows = data || [];
    setAttendedIds(new Set(rows.map((r) => r.pnm_id)));
    setCheckedInCount(rows.length);
    const unphotographed = rows.filter((r) => !r.pnms || !r.pnms.photo_path);
    setWaiting({
      left: unphotographed.filter((r) => r.side === "left").length,
      right: unphotographed.filter((r) => r.side === "right").length,
    });
  }

  // Success panel: shown only after the attendance write succeeds. Same
  // 3.5s as before; "Next person" ends it early. One timer at a time so a
  // stale timer can't cut the next person's message short.
  function showSuccess(first, needsPhoto, queued = false) {
    clearTimeout(flashTimer.current);
    setFlash({ first, needsPhoto, queued });
    flashTimer.current = setTimeout(() => {
      setFlash(null);
      focusId();
    }, 3500);
  }
  function nextPerson() {
    clearTimeout(flashTimer.current);
    setFlash(null);
    focusId();
  }
  function focusId() {
    setTimeout(() => idRef.current?.focus(), 0);
  }
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  function resetForm() {
    setPsuId("");
    setFirstName("");
    setLastName("");
    setYear("");
    setMajor("");
    setMajorSearch("");
    setStep("id");
    setIdError("");
    setIdWarning(false);
    setOffline(false);
    setCanonical(null);
    setExistingPnm(null);
    setSubmitting(false);
    setFormError("");
    setDupMatches([]);
    setMajorNote("");
    focusId();
  }

  // Keep the names typed so far; just reopen the ID field for correction.
  function editId() {
    setStep("id");
    setIdError("");
    setIdWarning(false);
    setOffline(false);
    setCanonical(null);
    setExistingPnm(null);
    setDupMatches([]);
    setFormError("");
    focusId();
  }

  // Duplicate guard. FA26 had 7 hand-merged duplicates: a mistyped ID that
  // matched nobody created a second record for someone already in the
  // system. Before creating a new person, look for an existing one with the
  // same name, or the same first OR last name and an ID within 2 typos.
  // Read-only; a failed check never blocks a check-in.
  async function findLikelyDuplicates(first, last, enteredId) {
    const esc = (v) => v.replace(/[\\%_]/g, (c) => "\\" + c);
    const cols = "id, psu_id, first_name, last_name, major, year, photo_path";
    const norm = (v) => (v || "").trim().toLowerCase();
    try {
      const [byLast, byFirst] = await Promise.all([
        supabase.from("pnms").select(cols).ilike("last_name", esc(last)).limit(50),
        supabase.from("pnms").select(cols).ilike("first_name", esc(first)).limit(50),
      ]);
      if (byLast.error) throw byLast.error;
      if (byFirst.error) throw byFirst.error;
      const id = norm(enteredId);
      const close = (p) => id && levenshtein(id, norm(p.psu_id)) <= 2;
      const seen = new Map();
      for (const p of [...(byLast.data || []), ...(byFirst.data || [])]) {
        if (seen.has(p.id) || norm(p.psu_id) === id) continue;
        const sameFirst = norm(p.first_name) === norm(first);
        const sameLast = norm(p.last_name) === norm(last);
        if ((sameFirst && sameLast) || ((sameFirst || sameLast) && close(p)))
          seen.set(p.id, p);
      }
      return [...seen.values()].slice(0, 3);
    } catch (e) {
      console.error("duplicate check failed", e);
      return [];
    }
  }

  // Only show enough of another person's ID to recognise your own.
  function maskId(v) {
    const t = (v || "").toLowerCase();
    return t.length <= 4 ? t : `${t.slice(0, 3)}${"•".repeat(Math.max(1, t.length - 5))}${t.slice(-2)}`;
  }

  async function confirmDuplicate(p) {
    if (submitting) return;
    if (attendedIds.has(p.id)) {
      setFormError(`${p.first_name} is already checked in to this event.`);
      return;
    }
    setSubmitting(true);
    try {
      await checkIn(p.id); // existing record untouched; only attendance added
      showSuccess(p.first_name, !p.photo_path);
      resetForm();
    } catch (e) {
      if (isNetworkError(e) && saveOffline({ kind: "existing", pnm_id: p.id,
        name: `${p.first_name} ${p.last_name}` })) {
        showSuccess(p.first_name, !p.photo_path, true);
        resetForm();
        return;
      }
      setFormError(e.message || "Check-in failed.");
      setSubmitting(false);
    }
  }

  // Canonicalisation is done by the database function, never re-implemented
  // here. One regex exists in the system and it lives in Postgres.
  // Returns { canon, unreachable }. An unreachable RPC is NOT a malformed ID.
  // Collapsing the two flags every person who signs in during a network blip.
  async function canonicalize(raw) {
    try {
      const { data, error } = await supabase.rpc("normalize_psu_id_soft", {
        raw,
      });
      if (error) throw error;
      return { canon: data || null, unreachable: false };
    } catch (e) {
      console.error("normalize rpc failed", e);
      return { canon: null, unreachable: true };
    }
  }

  async function handleIdNext() {
    if (checking) return;
    setChecking(true);
    try {
      await idNext();
    } finally {
      setChecking(false);
    }
  }

  async function idNext() {
    const raw = psuId.trim();
    if (!raw) {
      setIdError("Enter a PSU ID.");
      return;
    }
    setIdError("");

    const { canon, unreachable } = await canonicalize(raw);
    setCanonical(canon);
    setIdWarning(!canon && !unreachable);
    setOffline(unreachable);

    if (unreachable) {
      // Cannot canonicalise and cannot look up. Collect full details rather than
      // flagging the ID, and let the runner know why we are asking.
      if (isQueued(eventId, { rawId: raw })) {
        setIdError("Already checked in to this event (saved on this laptop).");
        return;
      }
      setStep("form");
      return;
    }

    if (!canon) {
      // Unrecognised shape. No rush profile can exist for it, so the profile
      // requirement turns it away; otherwise it goes through flagged.
      if (requireProfile) {
        setProfileBlock(true);
        return;
      }
      setStep("form");
      return;
    }

    // Brothers don't sign in as candidates. A failed check lets them through
    // (an offline check-in re-runs it at sync).
    const br = await supabase.rpc("kiosk_is_brother", { raw });
    if (!br.error && br.data === true) {
      setIdWarning(false);
      setIdError("This ID belongs to a brother. Brothers don't sign in here.");
      return;
    }

    const { data, error } = await supabase
      .from("pnms")
      .select("*")
      .eq("psu_id", canon)
      .maybeSingle();
    if (error) {
      console.error("pnm lookup failed", error);
      setOffline(true);
      setStep("form");
      return;
    }

    if (data) {
      if (attendedIds.has(data.id) || isQueued(eventId, { pnmId: data.id })) {
        setIdError("Already checked in to this event.");
        return;
      }
      if (requireProfile) {
        const pr = await supabase
          .from("rush_profiles")
          .select("pnm_id")
          .eq("pnm_id", data.id)
          .maybeSingle();
        // Can't verify (network): let them through rather than turn them away.
        if (!pr.error && !pr.data) {
          setProfileBlock(true);
          return;
        }
      }
      setExistingPnm(data);
      setStep("confirm");
    } else {
      if (requireProfile) {
        // Nobody with this ID exists, so no profile can be attached to it.
        setProfileBlock(true);
        return;
      }
      setStep("form");
    }
  }

  async function checkIn(pnmId) {
    const { error } = await supabase.from("attendance").insert({
      pnm_id: pnmId,
      event_id: eventId,
      station_id: stationId,
      side,
    });
    if (error) {
      if (error.code === "23505")
        throw new Error("Already checked in to this event.");
      throw error;
    }
    // Refresh directly rather than waiting on the realtime event, so the
    // dedup guard is correct on this station even if realtime is lagging.
    await load();
  }

  async function handleConfirmExisting() {
    setSubmitting(true);
    try {
      await checkIn(existingPnm.id);
      showSuccess(existingPnm.first_name, !existingPnm.photo_path);
      resetForm();
    } catch (e) {
      if (isNetworkError(e) && saveOffline({ kind: "existing", pnm_id: existingPnm.id,
        name: `${existingPnm.first_name} ${existingPnm.last_name}` })) {
        showSuccess(existingPnm.first_name, !existingPnm.photo_path, true);
        resetForm();
        return;
      }
      setIdError(e.message || "Check-in failed.");
      setSubmitting(false);
    }
  }

  // A major typed in full (any case) counts as picked; anything else must be
  // chosen from the list so majors stay consistent.
  // Any major is accepted. A close misspelling of a listed major is
  // corrected to the list spelling; anything else is kept as typed (tidied).
  function correctMajor(input) {
    const clean = (input || "").replace(/\s+/g, " ").trim();
    if (!clean) return { value: "", corrected: false };
    const key = (v) => v.toLowerCase().replace(/[^a-z0-9& ]/g, "");
    const k = key(clean);
    const exact = MAJORS.find((m) => key(m) === k);
    if (exact) return { value: exact, corrected: false };
    let best = null;
    let bestD = Infinity;
    for (const m of MAJORS) {
      const d = levenshtein(k, key(m));
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    // Short words get less slack so "Art" isn't turned into something else.
    const allow = k.length <= 5 ? 1 : k.length <= 10 ? 2 : 3;
    if (best && bestD <= allow) return { value: best, corrected: true };
    const value =
      clean === clean.toLowerCase()
        ? clean.replace(/\b[a-z]/g, (c) => c.toUpperCase())
        : clean;
    return { value, corrected: false };
  }

  function applyMajorCorrection() {
    if (major || !majorSearch.trim()) return;
    const r = correctMajor(majorSearch);
    setMajor(r.value);
    setMajorSearch("");
    setMajorNote(r.corrected ? `Spelling corrected to ${r.value}.` : "");
  }

  function resolveMajor() {
    return major || correctMajor(majorSearch).value;
  }

  async function handleSubmitNew(skipDupCheck = false) {
    if (submitting) return;
    const raw = psuId.trim();
    const pickedMajor = resolveMajor();
    const missing = [
      !firstName.trim() && "first name",
      !lastName.trim() && "last name",
      !year && "year",
      !pickedMajor && "major",
    ].filter(Boolean);
    if (missing.length) {
      setFormError(`Add your ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
      return;
    }
    setFormError("");
    if (!major) {
      const r = correctMajor(majorSearch);
      setMajor(r.value);
      setMajorSearch("");
      if (r.corrected) setMajorNote(`Spelling corrected to ${r.value}.`);
    }
    setSubmitting(true);
    if (!skipDupCheck) {
      const matches = await findLikelyDuplicates(
        firstName.trim(),
        lastName.trim(),
        canonical || raw,
      );
      if (matches.length) {
        setDupMatches(matches);
        setStep("dupe");
        setSubmitting(false);
        return;
      }
    }
    let createdId = null;
    try {
      // The trigger canonicalises psu_id and sets psu_id_unverified on write.
      let { data: pnm, error } = await supabase
        .from("pnms")
        .insert({
          psu_id: raw,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          major: pickedMajor,
          year,
          source_event_id: eventId,
        })
        .select("id, psu_id, psu_id_unverified")
        .single();

      // Another station created this person a moment ago. Fetch theirs and
      // continue rather than failing in front of a PNM.
      if (error && error.code === "23505" && canonical) {
        const res = await supabase
          .from("pnms")
          .select("id, psu_id, psu_id_unverified")
          .eq("psu_id", canonical)
          .single();
        if (res.error) throw res.error;
        pnm = res.data;
      } else if (error) {
        throw error;
      }

      createdId = pnm.id;
      if (pnm.psu_id_unverified) {
        const { error: rvErr } = await supabase.from("pnm_id_reviews").insert({
          pnm_id: pnm.id,
          raw_input: raw,
          event_id: eventId,
        });
        // A failed review filing must not block the check-in.
        if (rvErr) console.error("review filing failed", rvErr);
      }

      await checkIn(pnm.id);
      showSuccess(firstName.trim(), true);
      resetForm();
    } catch (e) {
      const name = `${firstName.trim()} ${lastName.trim()}`;
      if (isNetworkError(e) && saveOffline(
        createdId
          ? { kind: "existing", pnm_id: createdId, name }
          : { kind: "new", name, person: {
              psu_id: raw, first_name: firstName.trim(), last_name: lastName.trim(),
              major: pickedMajor, year } },
      )) {
        showSuccess(firstName.trim(), true, true);
        resetForm();
        return;
      }
      setIdError(e.message || "Submission failed.");
      setSubmitting(false);
    }
  }

  const filteredMajors = MAJORS.filter((m) =>
    m.toLowerCase().includes(majorSearch.toLowerCase()),
  );
  const sideName = side === "left" ? "Left" : side === "right" ? "Right" : "";
  const idErrorId = "k-id-error";
  const idHintId = "k-id-hint";

  function onStationSaved() {
    clearTimeout(flashTimer.current);
    setFlash(null);
    resetForm(); // re-renders with the new event/side; the eventId effect reloads
    navigate("/kiosk", { replace: true });
  }

  if (!eventId) {
    return (
      <div className="page">
        <div className="content">No event selected. Reload to set one.</div>
      </div>
    );
  }

  return (
    <div className="q-page k-page">
      <header className="k-header">
        <div className="k-brand">
          <span className="k-mark" aria-hidden="true">
            {BRAND.mark}
          </span>
          <span className="k-sep" aria-hidden="true" />
          <span className="k-appname">{BRAND.name} Rush</span>
        </div>
        <button
          type="button"
          className="k-controls-btn"
          onClick={() => {
            loadSettings(); // show the current shared value, not a stale one
            refreshPending();
            setStationOpen(true);
          }}
          aria-haspopup="dialog"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="k-controls-label">Station controls</span>
        </button>
      </header>

      <main className="k-main">
        <div className="k-center">
          <p className="k-event">{getEventLabel()}</p>
          <h1 className="k-title">Welcome to {BRAND.name} rush.</h1>
          <p className="k-sub">Enter your PSU ID to get started.</p>

          <section className="k-panel" aria-label="Rush sign-in">
            {flash ? (
              <div className="k-success" role="status">
                <span className="k-success-icon" aria-hidden="true">
                  ✓
                </span>
                <h2 className="k-success-title">
                  You're checked in, {flash.first}.
                </h2>
                <p className="k-success-text">
                  {flash.needsPhoto
                    ? `Head to the ${sideName.toLowerCase()} photo station for your headshot.`
                    : "Your headshot is already on file. You're all set."}
                </p>
                {flash.queued && (
                  <p className="k-queued-note">
                    Saved on this laptop. It will sync when the connection is
                    back.
                  </p>
                )}
                <button
                  type="button"
                  className="q-btn q-btn-secondary q-btn-block k-btn"
                  onClick={nextPerson}
                >
                  Next person
                </button>
              </div>
            ) : (
              <>
                <form
                  className="k-form"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (step === "id") handleIdNext();
                  }}
                >
                  <label className="k-label" htmlFor="k-psu-id">
                    PSU ID
                  </label>
                  <input
                    id="k-psu-id"
                    ref={idRef}
                    className={`k-input ${idWarning ? "is-warn" : ""} ${
                      idError && step === "id" ? "is-error" : ""
                    }`}
                    value={psuId}
                    onChange={(e) => {
                      setPsuId(e.target.value);
                      setIdError("");
                      setIdWarning(false);
                    }}
                    placeholder="e.g. abc1234"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    disabled={step !== "id"}
                    aria-invalid={!!idError || idWarning}
                    aria-describedby={
                      [idError && idErrorId, (idWarning || offline) && idHintId]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />

                  {idError && (
                    <p className="k-error" id={idErrorId} role="alert">
                      {idError}
                    </p>
                  )}

                  {profileBlock && (
                    <div className="q-alert k-block" role="alert">
                      <span className="q-alert-msg">
                        <strong>
                          Rush profile not filled out. Complete it before
                          entry.
                        </strong>
                        <br />
                        Fill it out at <strong>{BRAND.profileUrl}</strong>, then
                        sign in again. Clearing in {blockSeconds}s.
                      </span>
                      <button
                        type="button"
                        className="q-btn q-btn-secondary"
                        onClick={() => {
                          setProfileBlock(false);
                          setPsuId("");
                          setIdError("");
                          setStep("id");
                          focusId();
                        }}
                      >
                        Next person
                      </button>
                    </div>
                  )}

                  {offline && !idWarning && (
                    <p className="k-hint" id={idHintId}>
                      Offline. Enter your details in full; the ID is verified
                      when the network returns.
                    </p>
                  )}
                  {idWarning && (
                    <p className="k-warn" id={idHintId}>
                      That doesn't look like a PSU ID (three letters then 3–5
                      numbers). <strong>Double-check it. You can still continue.</strong>
                    </p>
                  )}

                  {step === "id" && (
                    <button
                      type="submit"
                      className="q-btn q-btn-primary q-btn-block k-btn k-continue"
                      disabled={checking}
                      aria-busy={checking}
                    >
                      {checking ? "Checking…" : "Continue →"}
                    </button>
                  )}
                </form>

                {step === "confirm" && existingPnm && (
                  <div className="k-step">
                    <div className="k-welcome">
                      <div className="k-welcome-name">
                        Welcome back, {existingPnm.first_name}{" "}
                        {existingPnm.last_name}
                      </div>
                      <div className="k-welcome-meta">
                        {existingPnm.major || "—"} · {existingPnm.year || "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="q-btn q-btn-primary q-btn-block k-btn"
                      onClick={handleConfirmExisting}
                      disabled={submitting}
                      aria-busy={submitting}
                      autoFocus
                    >
                      {submitting ? "Checking in…" : "✓ Check in"}
                    </button>
                    <button
                      type="button"
                      className="q-btn q-btn-secondary q-btn-block"
                      onClick={resetForm}
                      disabled={submitting}
                    >
                      Not me, go back
                    </button>
                  </div>
                )}

                {step === "dupe" && (
                  <div className="k-step" role="group" aria-labelledby="k-dupe-title">
                    <p className="k-dupe-title" id="k-dupe-title">
                      Are you already registered?
                    </p>
                    <p className="k-hint">
                      We found someone with a similar name or user ID. If one of
                      these is you, choose it so you aren't registered twice.
                    </p>
                    <ul className="k-dupe-list">
                      {dupMatches.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="k-dupe-opt"
                            onClick={() => confirmDuplicate(p)}
                            disabled={submitting}
                          >
                            <span className="k-dupe-name">
                              {p.first_name} {p.last_name}
                            </span>
                            <span className="k-dupe-meta">
                              {maskId(p.psu_id)} · {p.major || "—"} · {p.year || "—"}
                            </span>
                            <span className="k-dupe-cta">That's me</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {formError && (
                      <p className="k-error" role="alert">
                        {formError}
                      </p>
                    )}
                    <button
                      type="button"
                      className="q-btn q-btn-secondary q-btn-block k-btn"
                      onClick={() => handleSubmitNew(true)}
                      disabled={submitting}
                      aria-busy={submitting}
                    >
                      {submitting
                        ? "Checking in…"
                        : `No, I'm new. Register ${canonical || psuId.trim()}`}
                    </button>
                    <button
                      type="button"
                      className="q-btn q-btn-quiet"
                      onClick={editId}
                      disabled={submitting}
                    >
                      Edit my ID
                    </button>
                  </div>
                )}

                {step === "form" && (
                  <form
                    className="k-step"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSubmitNew();
                    }}
                  >
                    <div className="k-registering">
                      <span>
                        Registering as{" "}
                        <strong>{canonical || psuId.trim()}</strong>
                      </span>
                      <button
                        type="button"
                        className="q-btn q-btn-quiet k-edit-id"
                        onClick={editId}
                        disabled={submitting}
                      >
                        Edit ID
                      </button>
                    </div>
                    <div className="k-grid2">
                      <label className="q-field">
                        <span className="k-label">First name</span>
                        <input
                          className="k-input k-input-sm"
                          value={firstName}
                          onChange={(e) => {
                            setFirstName(e.target.value);
                            setFormError("");
                          }}
                          placeholder="First"
                          autoComplete="off"
                          autoFocus
                        />
                      </label>
                      <label className="q-field">
                        <span className="k-label">Last name</span>
                        <input
                          className="k-input k-input-sm"
                          value={lastName}
                          onChange={(e) => {
                            setLastName(e.target.value);
                            setFormError("");
                          }}
                          placeholder="Last"
                          autoComplete="off"
                        />
                      </label>
                    </div>

                    <fieldset className="q-field">
                      <legend className="k-label">Year</legend>
                      <div className="k-years">
                        {YEARS.map((y) => (
                          <label
                            key={y}
                            className={`q-seg-btn q-radio-label ${year === y ? "is-active" : ""}`}
                          >
                            <input
                              type="radio"
                              name="k-year"
                              value={y}
                              checked={year === y}
                              onChange={() => {
                                setYear(y);
                                setFormError("");
                              }}
                              className="q-radio"
                            />
                            {y}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div
                      className="q-field k-major"
                      onBlur={(e) => {
                        // Close the suggestions once focus leaves the field and
                        // its list, so they never sit on top of Submit.
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setShowMajorList(false);
                          applyMajorCorrection();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setShowMajorList(false);
                      }}
                    >
                      <label className="k-label" htmlFor="k-major">
                        Major
                      </label>
                      <input
                        id="k-major"
                        className="k-input k-input-sm"
                        value={major || majorSearch}
                        onChange={(e) => {
                          setMajorSearch(e.target.value);
                          setMajor("");
                          setMajorNote("");
                          setShowMajorList(true);
                          setFormError("");
                        }}
                        onFocus={() => setShowMajorList(true)}
                        placeholder="Type your major"
                        autoComplete="off"
                        aria-expanded={
                          showMajorList &&
                          (!!majorSearch || !major) &&
                          filteredMajors.length > 0
                        }
                        aria-controls="k-major-list"
                        aria-describedby={majorNote ? "k-major-note" : undefined}
                      />
                      {majorNote && (
                        <p className="k-hint" id="k-major-note" role="status">
                          {majorNote}
                        </p>
                      )}
                      {showMajorList &&
                        (majorSearch || !major) &&
                        filteredMajors.length > 0 && (
                        <div className="k-major-list" id="k-major-list">
                          {filteredMajors.map((m) => (
                            <button
                              key={m}
                              type="button"
                              className="k-major-opt"
                              onClick={() => {
                                setMajor(m);
                                setMajorSearch("");
                                setMajorNote("");
                                setShowMajorList(false);
                                setFormError("");
                              }}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {formError && (
                      <p className="k-error" role="alert">
                        {formError}
                      </p>
                    )}
                    <button
                      type="submit"
                      className="q-btn q-btn-primary q-btn-block k-btn"
                      disabled={submitting}
                      aria-busy={submitting}
                    >
                      {submitting ? "Submitting…" : "Submit & check in"}
                    </button>
                    <button
                      type="button"
                      className="q-btn q-btn-secondary q-btn-block"
                      onClick={resetForm}
                      disabled={submitting}
                    >
                      ← Go back
                    </button>
                  </form>
                )}
              </>
            )}
          </section>

          <p className="k-station">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
            </svg>
            {sideName} sign-in station · {stationId}
          </p>
        </div>
      </main>

      <footer className="k-footer">
        <div className="k-stats">
          {pending.some((p) => p.status === "pending") && (
            <span className="k-pending" role="status">
              {syncing ? "Syncing… " : ""}
              {pending.filter((p) => p.status === "pending").length} check-in
              {pending.filter((p) => p.status === "pending").length === 1 ? "" : "s"}{" "}
              waiting to sync
            </span>
          )}
          {pending.some((p) => p.status === "failed") && (
            <span className="k-pending k-pending-bad">
              {pending.filter((p) => p.status === "failed").length} couldn't sync,
              see Station controls
            </span>
          )}
          {requireProfile && (
            <span className="k-required">Rush profile required</span>
          )}
          <span>
            <strong>{checkedInCount}</strong> checked in{" "}
            <span className="k-scope">(both sides)</span>
          </span>
          <span className="k-divider" aria-hidden="true" />
          <span>
            <strong>{waiting[side] || 0}</strong> waiting for photo{" "}
            <span className="k-scope">({sideName})</span>
          </span>
        </div>
        <nav className="k-queues" aria-label="Photo queues">
          {["left", "right"].map((s, i) => (
            <span key={s} className="k-queue-item">
              {i > 0 && <span className="k-divider" aria-hidden="true" />}
              <Link to={`/queue/${s}`} className="k-queue-link">
                {s === "left" ? "Left" : "Right"} queue
                <span className="k-queue-count">
                  {waiting[s]}
                  <span className="q-sr-only"> waiting for photo</span>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            </span>
          ))}
        </nav>
      </footer>

      <StationControls
        open={stationOpen}
        onClose={() => setStationOpen(false)}
        onSaved={onStationSaved}
        title="Station controls"
        links={[
          { to: "/queue/left", label: "Left photo queue", hint: waiting.left },
          { to: "/queue/right", label: "Right photo queue", hint: waiting.right },
        ]}
        note="All kiosk stations share the same live database, so check-ins appear everywhere instantly."
        extra={
          <div className="k-ctl">
            <label className="k-switch">
              <input
                type="checkbox"
                checked={requireProfile}
                disabled={settingBusy}
                onChange={(e) => toggleRequireProfile(e.target.checked)}
              />
              <span>Require rush profiles</span>
            </label>
            <p className="q-settings-note">
              Takes effect immediately on every station (no Save needed).
              Candidates without a rush profile are turned away at the ID step.
            </p>
            {settingError && (
              <p className="k-error" role="alert">
                {settingError}
              </p>
            )}

            <div className="k-ctl-sync">
              <span>
                Saved on this laptop:{" "}
                <strong>
                  {pending.filter((p) => p.status === "pending").length}
                </strong>{" "}
                waiting
                {pending.some((p) => p.status !== "pending") &&
                  `, ${pending.filter((p) => p.status !== "pending").length} need attention`}
              </span>
              <button
                type="button"
                className="q-btn q-btn-secondary"
                onClick={flushQueue}
                disabled={syncing || !pending.some((p) => p.status === "pending")}
                aria-busy={syncing}
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {pending
              .filter((p) => p.status !== "pending")
              .map((p) => (
                <div key={p.qid} className="k-ctl-issue">
                  <span>
                    <strong>{p.name || p.person?.psu_id}</strong>
                    {p.person?.psu_id ? ` (${p.person.psu_id})` : ""}: {p.reason}
                  </span>
                  <span className="k-ctl-issue-actions">
                    {p.status === "failed" && (
                      <button
                        type="button"
                        className="q-btn q-btn-quiet"
                        onClick={() => {
                          updateItem(p.qid, { status: "pending", reason: null });
                          refreshPending();
                          flushQueue();
                        }}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      className="q-btn q-btn-quiet"
                      onClick={() => {
                        removeItem(p.qid);
                        refreshPending();
                      }}
                    >
                      Dismiss
                    </button>
                  </span>
                </div>
              ))}
          </div>
        }
      />
    </div>
  );
}
