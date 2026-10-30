import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { initials, avatarColor } from "../lib/utils";
import { BRAND } from "../lib/brand";
import {
  getEventId,
  getEventLabel,
  getStationId,
  getSide,
} from "../components/AuthGate";
import "../queue.css";

const BUCKET = "pnm-photos";

export default function Camera() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const targetPnmId = searchParams.get("id"); // now a pnms.id uuid
  // The queue the person was tapped from. Falls back to the station's side
  // for old links. Without this, a Left station photographing someone in the
  // Right queue loaded the Left list and could not find them.
  const sideParam = searchParams.get("side");
  const side =
    sideParam === "left" || sideParam === "right" ? sideParam : getSide();
  const eventId = getEventId();

  const [pnm, setPnm] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [stream, setStream] = useState(null);
  const [captured, setCaptured] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [camError, setCamError] = useState(null);
  const [successName, setSuccessName] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const savingRef = useRef(false); // blocks a double tap before re-render
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const confirmBtnRef = useRef(null);

  const fullName = (p) => (p ? `${p.first_name} ${p.last_name}` : "");

  // Attendees at THIS event who have never been photographed.
  // photo_path lives on pnms, so one headshot per person, ever.
  async function load() {
      if (!eventId) return;
      const { data, error } = await supabase
        .from("attendance")
        .select(
          "id, pnm_id, signed_in_at, pnms!inner(id, psu_id, first_name, last_name, major, year, psu_id_unverified, photo_path)",
        )
        .eq("event_id", eventId)
        .eq("side", side)
        .is("pnms.photo_path", null)
        .order("signed_in_at", { ascending: true });

      if (error) {
        console.error("camera load failed", error);
        setLoadError(true);
        return;
      }
      setLoadError(false);
      const rows = data || [];
      setWaiting(rows);

      const target = targetPnmId
        ? rows.find((r) => r.pnm_id === targetPnmId)
        : rows[0];
      if (target) {
        setAttendance(target);
        setPnm(target.pnms);
      } else {
        setAttendance(null);
        setPnm(null);
      }
  }

  useEffect(() => {
    load();
  }, [targetPnmId, eventId, side]);

  // The camera page had no realtime subscription, so new sign-ins and photos
  // taken on other devices never appeared until a reload.
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel("attendance-camera")
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
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "attendance" },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pnms" },
        () => load(),
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [targetPnmId, eventId, side]);

  // Same iOS resume problem as the queue: re-pull when the page comes back
  // instead of making the photographer reload. Keyed on the same attendance
  // id, so a photo already captured on screen is not discarded.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [targetPnmId, eventId, side]);

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  useEffect(
    () => () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    },
    [stream],
  );
  useEffect(() => {
    setCaptured(null);
    setCamError(null);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }, [attendance?.id]);

  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      setStream(s);
      setCamError(null);
    } catch {
      setCamError('Camera unavailable — use "Upload photo" below.');
    }
  }

  function snap() {
    const video = videoRef.current,
      canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    setCaptured(canvas.toDataURL("image/jpeg", 0.85));
    stream.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  function retake() {
    setCaptured(null);
    startCamera();
  }
  function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCaptured(ev.target.result);
    reader.readAsDataURL(file);
  }

  async function confirm(e) {
    if (!pnm || !captured || savingRef.current) return;
    savingRef.current = true;
    setSaveError(null);
    setUploading(true);
    try {
      const res = await fetch(captured);
      const blob = await res.blob();

      // Path is keyed on the pnms uuid, not the PSU ID, so a flagged id that
      // later gets corrected does not orphan the file.
      const path = `${pnm.id}/${Date.now()}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (uploadErr) throw uploadErr;

      // Bucket is private: store the PATH, not a URL. Signed URLs are minted
      // at display time and expire.
      const { error: updErr } = await supabase
        .from("pnms")
        .update({ photo_path: path })
        .eq("id", pnm.id);
      if (updErr) throw updErr;

      setSuccessName(fullName(pnm));
      setCaptured(null);
      setUploading(false);
      setTimeout(() => {
        setSuccessName(null);
        const remaining = waiting.filter((r) => r.pnm_id !== pnm.id);
        savingRef.current = false;
        if (remaining.length > 0)
          navigate(`/camera?id=${remaining[0].pnm_id}&side=${side}`);
        else navigate(`/queue/${side}`);
      }, 1800);
    } catch (err) {
      setSaveError(err.message || "unknown error");
      setUploading(false);
      savingRef.current = false;
    }
  }

  const nextUp = waiting.find((r) => r.pnm_id !== pnm?.id);
  const others = waiting.filter((r) => r.pnm_id !== pnm?.id);
  const sideName = side === "left" ? "Left" : "Right";

  if (!eventId) {
    return (
      <div className="page">
        <div className="content">No event selected. Reload to set one.</div>
      </div>
    );
  }

  const header = (
    <header className="q-header">
      <div className="q-header-inner">
        <div className="q-brandrow">
          <span className="q-brandrow-left">
            <span className="q-mark" aria-hidden="true">
              {BRAND.mark}
            </span>
            <span>Photo station</span>
          </span>
          <Link to={`/queue/${side}`} className="q-back">
            ← {sideName} queue
          </Link>
        </div>
        <h1 className="q-event">{getEventLabel()}</h1>
        <p className="q-station">
          Station {getStationId()} · Photographing the {sideName.toLowerCase()}{" "}
          queue · {waiting.length} waiting
        </p>
      </div>
    </header>
  );

  // A save that just finished takes precedence: the realtime reload removes
  // the photographed person from `waiting` before the hand-off timer fires.
  if (successName) {
    return (
      <div className="q-page">
        {header}
        <main className="q-main">
          <div className="q-success" role="status">
            <span className="q-check" aria-hidden="true">
              ✓
            </span>
            Photo saved for {successName}. Loading the next person…
          </div>
        </main>
      </div>
    );
  }

  if (!pnm && waiting.length === 0) {
    return (
      <div className="q-page">
        {header}
        <main className="q-main">
          {loadError ? (
            <div className="q-alert" role="alert">
              <span className="q-alert-msg">
                Couldn't load the queue. Check the connection.
              </span>
              <button
                type="button"
                className="q-btn q-btn-secondary"
                onClick={load}
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="q-empty">
              <div className="q-empty-title">Queue is empty</div>
              All photos taken, or no one has checked in yet.
            </div>
          )}
          <button
            type="button"
            className="q-btn q-btn-navy q-btn-block q-btn-lg"
            onClick={() => navigate(`/queue/${side}`)}
          >
            Back to {sideName.toLowerCase()} queue
          </button>
        </main>
      </div>
    );
  }

  const [abg, atxt] = avatarColor(pnm?.id || "x");

  return (
    <div className="q-page">
      {header}
      <main className="q-main">
        {pnm ? (
          <section className="q-section" aria-label="Now photographing">
            <div className="q-person">
              <div
                className="q-avatar q-avatar-lg"
                style={{ background: abg, color: atxt }}
                aria-hidden="true"
              >
                {initials(fullName(pnm))}
              </div>
              <div className="q-who-text">
                <div className="q-name">{fullName(pnm)}</div>
                <div className="q-id">
                  <span>{pnm.psu_id}</span>
                  {pnm.psu_id_unverified && (
                    <span className="q-flag">Verify ID</span>
                  )}
                </div>
                <div className="q-meta">
                  {pnm.major || "—"} · {pnm.year || "—"}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className="q-alert" role="alert">
            <span className="q-alert-msg">
              This person isn't waiting in the {sideName.toLowerCase()} queue
              anymore. Pick someone below.
            </span>
          </div>
        )}

        {saveError && (
          <div className="q-alert" role="alert">
            <span className="q-alert-msg">
              Save failed: {saveError}. The photo is still here; try again.
            </span>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />
        {pnm && (
          <div className="q-capture">
            {captured ? (
              <>
                <img
                  src={captured}
                  alt={`Preview of ${fullName(pnm)}'s photo`}
                  className="q-capture-media"
                />
                <div className="q-capture-actions">
                  <div className="q-capture-row">
                    <button
                      type="button"
                      className="q-btn q-btn-secondary q-btn-lg"
                      onClick={retake}
                      disabled={uploading}
                    >
                      Retake
                    </button>
                    <button
                      ref={confirmBtnRef}
                      type="button"
                      className="q-btn q-btn-primary q-btn-lg"
                      onClick={confirm}
                      disabled={uploading}
                      aria-busy={uploading}
                    >
                      {uploading ? "Saving…" : "✓ Use this photo"}
                    </button>
                  </div>
                </div>
              </>
            ) : stream ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="q-capture-media"
                />
                <div className="q-capture-actions">
                  <button
                    type="button"
                    className="q-btn q-btn-primary q-btn-block q-btn-lg"
                    onClick={snap}
                  >
                    Take photo
                  </button>
                </div>
              </>
            ) : (
              <div className="q-capture-empty">
                {camError && (
                  <div className="q-alert" role="alert">
                    <span className="q-alert-msg">{camError}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="q-btn q-btn-primary q-btn-block q-btn-lg"
                  onClick={startCamera}
                >
                  Open camera
                </button>
                <label className="q-btn q-btn-secondary q-btn-block q-upload-label">
                  Upload photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleUpload}
                    className="q-sr-only"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {others.length > 0 && (
          <section className="q-section" aria-labelledby="q-others-title">
            <div className="q-section-head">
              <h2 className="q-section-title" id="q-others-title">
                {pnm ? "Next in line" : "Waiting for photo"}
              </h2>
              <span className="q-section-count">{others.length}</span>
            </div>
            <ul className="q-next-list">
              {others.slice(0, 4).map((r, i) => {
                const [bg, fg] = avatarColor(r.pnm_id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="q-next-row"
                      onClick={() =>
                        navigate(`/camera?id=${r.pnm_id}&side=${side}`)
                      }
                      aria-label={`Photograph ${fullName(r.pnms)} instead`}
                    >
                      <div
                        className="q-avatar q-avatar-sm"
                        style={{ background: bg, color: fg }}
                        aria-hidden="true"
                      >
                        {initials(fullName(r.pnms))}
                      </div>
                      <span className="q-done-main">
                        {i === 0 && nextUp && (
                          <span className="q-next-label">Up next</span>
                        )}
                        <span className="q-done-name" style={{ display: "block" }}>
                          {fullName(r.pnms)}
                        </span>
                        <span className="q-done-meta" style={{ display: "block" }}>
                          {r.pnms?.major}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
