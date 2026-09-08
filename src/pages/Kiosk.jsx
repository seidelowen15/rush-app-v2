import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  getEventId,
  getEventLabel,
  getStationId,
  clearEvent,
} from "../components/AuthGate";

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

export function NavBar({ waitingCount }) {
  const loc = useLocation();
  return (
    <div className="topbar">
      <Link to="/kiosk" className="topbar-brand">
        <span>AKΨ</span>
      </Link>
      <div
        className="topbar-event"
        title="Tap to change event"
        style={{ cursor: "pointer" }}
        onClick={() => {
          if (confirm("Change event for this station?")) {
            clearEvent();
            location.reload();
          }
        }}
      >
        {getEventLabel()} · {getStationId()}
      </div>
      <Link
        to="/kiosk"
        className={`nav-link ${loc.pathname === "/kiosk" ? "active" : ""}`}
      >
        Sign-in kiosk
      </Link>
      <Link
        to="/queue"
        className={`nav-link ${loc.pathname === "/queue" ? "active" : ""}`}
      >
        Photo queue
        {waitingCount > 0 && <span className="badge">{waitingCount}</span>}
      </Link>
      <button
        className="nav-link"
        style={{
          marginLeft: "auto",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
        onClick={async () => {
          if (!confirm("Sign this station out?")) return;
          clearEvent();
          localStorage.removeItem("kiosk_station_id");
          await supabase.auth.signOut();
          location.reload();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function StatCard({ label, value }) {
  const [display, setDisplay] = useState(value);
  const [bump, setBump] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value !== prev.current) {
      setBump(true);
      setTimeout(() => setBump(false), 350);
      prev.current = value;
    }
    setDisplay(value);
  }, [value]);
  return (
    <div className="stat-card">
      <div className={`stat-num ${bump ? "bump" : ""}`}>{display}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Kiosk() {
  const eventId = getEventId();
  const stationId = getStationId();

  // pnm_id values already checked in TO THIS EVENT. Scoped per event, so a
  // returning PNM can check in again on a later night.
  const [attendedIds, setAttendedIds] = useState(new Set());
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [waitingCount, setWaitingCount] = useState(0);

  const [psuId, setPsuId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [year, setYear] = useState("");
  const [major, setMajor] = useState("");
  const [majorSearch, setMajorSearch] = useState("");
  const [showMajorList, setShowMajorList] = useState(false);
  const [step, setStep] = useState("id");
  const [flash, setFlash] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [idError, setIdError] = useState("");
  const [idWarning, setIdWarning] = useState(false); // soft: unrecognised shape
  const [canonical, setCanonical] = useState(null);
  const [existingPnm, setExistingPnm] = useState(null);

  useEffect(() => {
    if (!eventId) return;
    load();
    const channel = supabase
      .channel("attendance-kiosk")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance",
          filter: `event_id=eq.${eventId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId]);

  // One query drives all three numbers. photo_path lives on pnms (one headshot
  // per person, ever), so "waiting for photo" means attendees at this event who
  // have never been photographed.
  async function load() {
    const { data, error } = await supabase
      .from("attendance")
      .select("pnm_id, pnms(photo_path)")
      .eq("event_id", eventId);
    if (error) {
      console.error("load failed", error);
      return;
    }
    const rows = data || [];
    setAttendedIds(new Set(rows.map((r) => r.pnm_id)));
    setCheckedInCount(rows.length);
    setWaitingCount(rows.filter((r) => !r.pnms || !r.pnms.photo_path).length);
  }

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
    setCanonical(null);
    setExistingPnm(null);
    setSubmitting(false);
  }

  // Canonicalisation is done by the database function, never re-implemented
  // here. One regex exists in the system and it lives in Postgres.
  async function canonicalize(raw) {
    const { data, error } = await supabase.rpc("normalize_psu_id_soft", {
      raw,
    });
    if (error) {
      console.error("normalize rpc failed", error);
      return null;
    }
    return data;
  }

  async function handleIdNext() {
    const raw = psuId.trim();
    if (!raw) {
      setIdError("Enter a PSU ID.");
      return;
    }
    setIdError("");

    const canon = await canonicalize(raw);
    setCanonical(canon);
    setIdWarning(!canon);

    if (!canon) {
      // Unrecognised shape. Still allowed through — it will be stored flagged
      // and filed for review. We cannot match it to an existing person.
      setStep("form");
      return;
    }

    const { data, error } = await supabase
      .from("pnms")
      .select("*")
      .eq("psu_id", canon)
      .maybeSingle();
    if (error) {
      setIdError(error.message);
      return;
    }

    if (data) {
      if (attendedIds.has(data.id)) {
        setIdError("Already checked in to this event.");
        return;
      }
      setExistingPnm(data);
      setStep("confirm");
    } else {
      setStep("form");
    }
  }

  async function checkIn(pnmId) {
    const { error } = await supabase.from("attendance").insert({
      pnm_id: pnmId,
      event_id: eventId,
      station_id: stationId,
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
      setFlash(`${existingPnm.first_name} ${existingPnm.last_name}`);
      resetForm();
      setTimeout(() => setFlash(null), 3500);
    } catch (e) {
      setIdError(e.message || "Check-in failed.");
      setSubmitting(false);
    }
  }

  async function handleSubmitNew() {
    const raw = psuId.trim();
    if (!firstName.trim() || !lastName.trim() || !year || !major) return;
    setSubmitting(true);
    try {
      // The trigger canonicalises psu_id and sets psu_id_unverified on write.
      let { data: pnm, error } = await supabase
        .from("pnms")
        .insert({
          psu_id: raw,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          major,
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
      setFlash(`${firstName.trim()} ${lastName.trim()}`);
      resetForm();
      setTimeout(() => setFlash(null), 3500);
    } catch (e) {
      setIdError(e.message || "Submission failed.");
      setSubmitting(false);
    }
  }

  const filteredMajors = MAJORS.filter((m) =>
    m.toLowerCase().includes(majorSearch.toLowerCase()),
  );
  const inputStyle = {
    width: "100%",
    padding: "11px 13px",
    borderRadius: "var(--radius)",
    border: "1.5px solid var(--border2)",
    background: "var(--bg)",
    color: "var(--text)",
    outline: "none",
    fontSize: 15,
    fontFamily: "inherit",
    transition: "border-color .15s",
  };
  const idInputStyle = idWarning
    ? { ...inputStyle, border: "2px solid var(--red-text)" }
    : inputStyle;
  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text2)",
    marginBottom: 5,
    display: "block",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  if (!eventId) {
    return (
      <div className="page">
        <div className="content">No event selected. Reload to set one.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <NavBar waitingCount={waitingCount} />
      <div
        className="content"
        style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}
      >
        <div className="stat-grid">
          <StatCard label="Checked in" value={checkedInCount} />
          <StatCard label="Waiting for photo" value={waitingCount} />
        </div>

        {flash && (
          <div
            className="banner banner-gold"
            style={{
              marginBottom: 14,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>✓</span> {flash} checked in and added
            to photo queue
          </div>
        )}

        <div
          className="card"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            borderTop: `3px solid var(--gold)`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--navy)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Rush sign-in
          </div>

          <div>
            <label style={labelStyle}>PSU ID</label>
            <input
              style={idInputStyle}
              value={psuId}
              onChange={(e) => {
                setPsuId(e.target.value);
                setIdError("");
                setIdWarning(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleIdNext()}
              placeholder="e.g. abc1234"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={step !== "id"}
            />

            {idError && (
              <div
                style={{ fontSize: 13, color: "var(--red-text)", marginTop: 6 }}
              >
                {idError}
              </div>
            )}

            {idWarning && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--red-text)",
                  marginTop: 6,
                  lineHeight: 1.45,
                }}
              >
                That doesn't look like a PSU ID (three letters then 3–5
                numbers).
                <strong> Double-check it — you can still continue.</strong>
              </div>
            )}

            {step === "id" && (
              <button
                className="btn btn-navy"
                style={{ width: "100%", marginTop: 10, padding: "11px 0" }}
                onClick={handleIdNext}
                disabled={!psuId.trim()}
              >
                Continue →
              </button>
            )}
          </div>

          {step === "confirm" && existingPnm && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                className="banner banner-navy"
                style={{ borderLeft: `4px solid var(--gold)` }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: 2,
                    color: "var(--gold)",
                  }}
                >
                  Welcome back, {existingPnm.first_name} {existingPnm.last_name}
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {existingPnm.major || "—"} · {existingPnm.year || "—"}
                </div>
              </div>
              <button
                className="btn btn-gold"
                style={{ width: "100%", padding: "11px 0" }}
                onClick={handleConfirmExisting}
                disabled={submitting}
              >
                {submitting ? "Checking in..." : "✓ Check in"}
              </button>
              <button
                className="btn"
                style={{ width: "100%", padding: "9px 0" }}
                onClick={resetForm}
              >
                Not me — go back
              </button>
            </div>
          )}

          {step === "form" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <label style={labelStyle}>First name</label>
                  <input
                    style={inputStyle}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First"
                    autoFocus
                  />
                </div>
                <div>
                  <label style={labelStyle}>Last name</label>
                  <input
                    style={inputStyle}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last"
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Year</label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 6,
                  }}
                >
                  {YEARS.map((y) => (
                    <button
                      key={y}
                      onClick={() => setYear(y)}
                      style={{
                        padding: "9px 0",
                        borderRadius: "var(--radius)",
                        fontSize: 13,
                        fontWeight: 600,
                        border: `1.5px solid ${year === y ? "var(--navy)" : "var(--border2)"}`,
                        background: year === y ? "var(--navy)" : "var(--bg2)",
                        color: year === y ? "var(--gold)" : "var(--text2)",
                        transition: "all .15s",
                      }}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ position: "relative" }}>
                <label style={labelStyle}>Major</label>
                <input
                  style={inputStyle}
                  value={major || majorSearch}
                  onChange={(e) => {
                    setMajorSearch(e.target.value);
                    setMajor("");
                    setShowMajorList(true);
                  }}
                  onFocus={() => setShowMajorList(true)}
                  placeholder="Search or type major..."
                />
                {showMajorList && (majorSearch || !major) && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      background: "var(--bg)",
                      border: "1px solid var(--border2)",
                      borderRadius: "var(--radius)",
                      maxHeight: 180,
                      overflowY: "auto",
                      marginTop: 2,
                      boxShadow: "0 4px 16px rgba(30,58,110,0.15)",
                    }}
                  >
                    {filteredMajors.map((m) => (
                      <div
                        key={m}
                        onClick={() => {
                          setMajor(m);
                          setMajorSearch("");
                          setShowMajorList(false);
                        }}
                        style={{
                          padding: "9px 12px",
                          cursor: "pointer",
                          fontSize: 13,
                          color: "var(--text)",
                          borderBottom: "0.5px solid var(--border)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--bg2)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        {m}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="btn btn-gold"
                style={{
                  width: "100%",
                  padding: "12px 0",
                  fontSize: 15,
                  marginTop: 2,
                }}
                onClick={handleSubmitNew}
                disabled={
                  submitting ||
                  !firstName.trim() ||
                  !lastName.trim() ||
                  !year ||
                  !major
                }
              >
                {submitting ? "Submitting..." : "Submit & check in"}
              </button>
              <button
                className="btn"
                style={{ width: "100%", padding: "9px 0" }}
                onClick={resetForm}
              >
                ← Go back
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--text3)",
            textAlign: "center",
          }}
        >
          All kiosk stations share the same live database.
        </div>
      </div>
    </div>
  );
}
