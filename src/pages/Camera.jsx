import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { initials, avatarColor } from "../lib/utils";
import { NavBar } from "./Kiosk";

import { getEventId, getSide } from "../components/AuthGate";

const BUCKET = "pnm-photos";

export default function Camera() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const targetPnmId = searchParams.get("id"); // now a pnms.id uuid
  const eventId = getEventId();

  const [pnm, setPnm] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [stream, setStream] = useState(null);
  const [captured, setCaptured] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [camError, setCamError] = useState(null);
  const [successName, setSuccessName] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const confirmBtnRef = useRef(null);

  const fullName = (p) => (p ? `${p.first_name} ${p.last_name}` : "");

  useEffect(() => {
    async function load() {
      if (!eventId) return;
      // Attendees at THIS event who have never been photographed.
      // photo_path lives on pnms, so one headshot per person, ever.
      const { data, error } = await supabase
        .from("attendance")
        .select(
          "id, pnm_id, signed_in_at, pnms!inner(id, psu_id, first_name, last_name, major, year, psu_id_unverified, photo_path)",
        )
        .eq("event_id", eventId)
        .eq("side", getSide())
        .is("pnms.photo_path", null)
        .order("signed_in_at", { ascending: true });

      if (error) {
        console.error("camera load failed", error);
        return;
      }
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
    load();
  }, [targetPnmId, eventId]);

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
    if (!pnm || !captured) return;
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
        if (remaining.length > 0) navigate(`/camera?id=${remaining[0].pnm_id}`);
        else navigate(`/queue/${getSide()}`);
      }, 1800);
    } catch (err) {
      alert("Save failed: " + (err.message || "unknown error"));
      setUploading(false);
    }
  }

  const nextUp = waiting.find((r) => r.pnm_id !== pnm?.id);

  if (!eventId) {
    return (
      <div className="page">
        <div className="content">No event selected. Reload to set one.</div>
      </div>
    );
  }

  if (!pnm && waiting.length === 0) {
    return (
      <div className="page">
        <NavBar waiting={{}} />
        <div
          className="content"
          style={{
            maxWidth: 500,
            margin: "0 auto",
            textAlign: "center",
            paddingTop: 60,
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 18,
              marginBottom: 8,
              color: "var(--navy)",
            }}
          >
            Queue is empty
          </div>
          <div
            style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20 }}
          >
            All photos taken, or no one has checked in yet.
          </div>
          <button className="btn btn-navy" onClick={() => navigate(`/queue/${getSide()}`)}>
            Back to queue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <NavBar waiting={{ [getSide()]: waiting.length }} />
      <div
        className="content"
        style={{ maxWidth: 520, margin: "0 auto", width: "100%" }}
      >
        {pnm && (
          <div
            className="banner banner-navy"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
              borderLeft: `4px solid var(--gold)`,
            }}
          >
            <div
              className="avatar"
              style={{
                background: "rgba(245,184,0,0.15)",
                color: "var(--gold)",
                border: "2px solid var(--gold)",
                width: 44,
                height: 44,
                fontSize: 14,
              }}
            >
              {initials(fullName(pnm))}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{ fontWeight: 700, fontSize: 15, color: "var(--gold)" }}
              >
                {fullName(pnm)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.6)",
                  marginTop: 2,
                }}
              >
                {pnm.psu_id} · {pnm.major} · {pnm.year}
              </div>
            </div>
            {pnm.psu_id_unverified && (
              <span className="pill pill-amber">Verify ID</span>
            )}
            <div
              style={{
                textAlign: "right",
                fontSize: 12,
                color: "rgba(255,255,255,0.4)",
              }}
            >
              {waiting.length - 1} more waiting
            </div>
          </div>
        )}

        {successName && (
          <div
            className="banner banner-gold"
            style={{
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>✓</span> Photo saved for{" "}
            {successName} — loading next person...
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div
          className="card"
          style={{
            padding: 0,
            overflow: "hidden",
            borderTop: `3px solid var(--gold)`,
          }}
        >
          {captured ? (
            <>
              <img
                src={captured}
                alt="Preview"
                style={{
                  width: "100%",
                  display: "block",
                  maxHeight: 380,
                  objectFit: "cover",
                }}
              />
              <div style={{ display: "flex", gap: 8, padding: 12 }}>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={retake}
                  disabled={uploading}
                >
                  Retake
                </button>
                <button
                  ref={confirmBtnRef}
                  className="btn btn-gold"
                  style={{ flex: 2 }}
                  onClick={confirm}
                  disabled={uploading}
                >
                  {uploading ? "Saving..." : "✓ Use this photo"}
                </button>
              </div>
            </>
          ) : stream ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  display: "block",
                  maxHeight: 380,
                  objectFit: "cover",
                }}
              />
              <div style={{ padding: 12 }}>
                <button
                  className="btn btn-navy"
                  style={{ width: "100%", padding: "11px 0", fontSize: 15 }}
                  onClick={snap}
                >
                  Take photo
                </button>
              </div>
            </>
          ) : (
            <div style={{ padding: 32, textAlign: "center" }}>
              {camError && (
                <div
                  className="banner banner-amber"
                  style={{ marginBottom: 16, textAlign: "left" }}
                >
                  {camError}
                </div>
              )}
              <button
                className="btn btn-navy"
                style={{ width: "100%", padding: "11px 0", marginBottom: 12 }}
                onClick={startCamera}
              >
                Open camera
              </button>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text3)",
                  marginBottom: 10,
                }}
              >
                or upload
              </div>
              <label
                className="btn"
                style={{ display: "inline-block", cursor: "pointer" }}
              >
                Upload photo
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleUpload}
                  style={{ display: "none" }}
                />
              </label>
            </div>
          )}
        </div>

        {nextUp && (
          <div
            style={{
              marginTop: 10,
              padding: "10px 14px",
              background: "var(--bg)",
              border: "0.5px solid var(--border)",
              borderRadius: "var(--radius)",
              fontSize: 13,
              color: "var(--text2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                color: "var(--text3)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Next up:
            </span>
            <strong style={{ color: "var(--text)" }}>
              {fullName(nextUp.pnms)}
            </strong>
            <span style={{ color: "var(--text3)" }}>
              · {nextUp.pnms?.major}
            </span>
          </div>
        )}

        {waiting.length > 1 && (
          <div style={{ marginTop: 10 }}>
            <div className="section-label" style={{ marginBottom: 6 }}>
              Others waiting
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {waiting
                .filter((r) => r.pnm_id !== pnm?.id)
                .slice(0, 3)
                .map((r) => (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/camera?id=${r.pnm_id}`)}
                    style={{
                      padding: "8px 12px",
                      background: "var(--bg)",
                      border: "0.5px solid var(--border)",
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      fontSize: 13,
                      color: "var(--text2)",
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{fullName(r.pnms)}</span>
                    <span style={{ color: "var(--text3)" }}>
                      {r.pnms?.major}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
