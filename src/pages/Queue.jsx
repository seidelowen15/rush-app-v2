import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { timeAgo, initials, avatarColor } from "../lib/utils";
import { NavBar } from "./Kiosk";
import { getEventId } from "../components/AuthGate";

const BUCKET = "pnm-photos";
const SIGNED_TTL = 60 * 60; // 1 hour

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.exiting ? "exiting" : ""}`}>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Just checked in
          </div>
          <div className="toast-name">{t.name}</div>
          <div className="toast-meta">
            {t.major} · {t.year}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Queue() {
  const eventId = getEventId();
  const [rows, setRows] = useState([]);
  const [signed, setSigned] = useState({}); // photo_path -> signed url
  const signedExp = useRef({}); // photo_path -> epoch ms expiry
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [newIds, setNewIds] = useState(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();

  const fullName = (p) => (p ? `${p.first_name} ${p.last_name}` : "?");

  async function load() {
    if (!eventId) {
      setLoading(false);
      return [];
    }
    const { data, error } = await supabase
      .from("attendance")
      .select(
        "id, pnm_id, signed_in_at, station_id, pnms(id, psu_id, first_name, last_name, major, year, psu_id_unverified, photo_path)",
      )
      .eq("event_id", eventId)
      .order("signed_in_at", { ascending: true });

    if (error) {
      console.error("queue load failed", error);
      setLoading(false);
      return [];
    }
    const list = data || [];
    setRows(list);
    setLoading(false);

    // Private bucket: mint short-lived signed URLs for the thumbnails. Only sign
    // paths we do not already hold a live URL for, and re-sign 5 minutes before
    // expiry so a display left open overnight does not go to broken images.
    const now = Date.now();
    const paths = list.map((r) => r.pnms?.photo_path).filter(Boolean);
    const need = paths.filter(
      (p) => (signedExp.current[p] || 0) - now < 5 * 60 * 1000,
    );
    if (need.length > 0) {
      const { data: urls, error: sErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(need, SIGNED_TTL);
      if (sErr) console.error("signing failed", sErr);
      else {
        const map = {};
        for (const u of urls || []) {
          if (u.path && u.signedUrl) {
            map[u.path] = u.signedUrl;
            signedExp.current[u.path] = now + SIGNED_TTL * 1000;
          }
        }
        setSigned((prev) => ({ ...prev, ...map }));
      }
    }
    return list;
  }

  useEffect(() => {
    load();
    if (!eventId) return;
    const channel = supabase
      .channel("attendance-queue")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance",
          filter: `event_id=eq.${eventId}`,
        },
        async (payload) => {
          const list = await load();
          const entry = list.find((r) => r.pnm_id === payload.new.pnm_id);
          if (entry?.pnms) {
            const p = entry.pnms;
            const toastId = Date.now();
            setToasts((prev) => [
              ...prev,
              { id: toastId, name: fullName(p), major: p.major, year: p.year },
            ]);
            setNewIds((prev) => new Set([...prev, payload.new.pnm_id]));
            setTimeout(
              () =>
                setNewIds((prev) => {
                  const s = new Set(prev);
                  s.delete(payload.new.pnm_id);
                  return s;
                }),
              1000,
            );
            setTimeout(
              () =>
                setToasts((prev) =>
                  prev.map((t) =>
                    t.id === toastId ? { ...t, exiting: true } : t,
                  ),
                ),
              3500,
            );
            setTimeout(
              () => setToasts((prev) => prev.filter((t) => t.id !== toastId)),
              3900,
            );
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "attendance",
          filter: `event_id=eq.${eventId}`,
        },
        () => load(),
      )
      // photo_path lives on pnms, which is in no attendance subscription. Without
      // this, the display stops updating the moment sign-ins stop -- exactly when
      // photographers are working the backlog and people are watching the screen.
      // No event_id filter is possible; pnms has no event column. During rush the
      // only writes to pnms are photo saves, so the extra traffic is one load per
      // photo.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pnms" },
        () => load(),
      )
      .subscribe();
    const poll = setInterval(() => load(), 10 * 60 * 1000);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }

  // Removes the check-in for THIS event only. The pnms row and any photo are
  // left alone -- the person still exists and may have attended other nights.
  async function deleteAttendance(attendanceId, e) {
    e.stopPropagation();
    if (!confirm("Remove this person from this event's check-in list?")) return;
    const { error } = await supabase
      .from("attendance")
      .delete()
      .eq("id", attendanceId);
    if (error) alert("Remove failed: " + error.message);
    load();
  }

  const waiting = rows.filter((r) => !r.pnms?.photo_path);
  const done = rows.filter((r) => r.pnms?.photo_path);

  if (!eventId) {
    return (
      <div className="page">
        <div className="content">No event selected. Reload to set one.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <NavBar waitingCount={waiting.length} />
      <Toast toasts={toasts} />
      <div
        className="content"
        style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div className="stat-grid" style={{ flex: 1, marginBottom: 0 }}>
            <div className="stat-card">
              <div className="stat-num">{rows.length}</div>
              <div className="stat-label">Checked in</div>
            </div>
            <div className="stat-card">
              <div className="stat-num">{waiting.length}</div>
              <div className="stat-label">Waiting for photo</div>
            </div>
          </div>
          <button
            className="fullscreen-btn"
            onClick={toggleFullscreen}
            style={{
              marginLeft: 12,
              whiteSpace: "nowrap",
              background: "var(--navy)",
              color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.15)",
              padding: "8px 12px",
              borderRadius: "var(--radius)",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {isFullscreen ? "⤡ Exit" : "⤢ Fullscreen"}
          </button>
        </div>

        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: 40,
              color: "var(--text3)",
              fontSize: 13,
            }}
          >
            Loading...
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: 48,
              color: "var(--text3)",
              fontSize: 13,
            }}
          >
            No one checked in yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {waiting.length > 0 && (
              <>
                <div className="section-label">Waiting for photo</div>
                {waiting.map((r, i) => {
                  const p = r.pnms;
                  const isNext = i === 0;
                  const [abg, atxt] = avatarColor(r.pnm_id);
                  const isNew = newIds.has(r.pnm_id);
                  return (
                    <div
                      key={r.id}
                      className={`queue-item ${isNext ? "is-next" : ""} ${isNew ? "new-entry" : ""}`}
                      onClick={() => navigate(`/camera?id=${r.pnm_id}`)}
                      style={{ cursor: "pointer" }}
                    >
                      <div
                        style={{
                          minWidth: 24,
                          textAlign: "center",
                          fontSize: 15,
                          fontWeight: 700,
                          color: isNext ? "var(--gold)" : "var(--text3)",
                        }}
                      >
                        {i + 1}
                      </div>
                      <div
                        className="avatar"
                        style={{
                          background: isNext ? "rgba(245,184,0,0.15)" : abg,
                          color: isNext ? "var(--gold)" : atxt,
                          border: isNext ? "2px solid var(--gold)" : "none",
                        }}
                      >
                        {initials(fullName(p))}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: isNext ? "var(--gold)" : "var(--text)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          {fullName(p)}
                          {isNext && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 400,
                                color: "rgba(245,184,0,0.7)",
                              }}
                            >
                              — tap to photograph
                            </span>
                          )}
                          {p?.psu_id_unverified && (
                            <span className="pill pill-amber">ID flagged</span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: isNext
                              ? "rgba(255,255,255,0.6)"
                              : "var(--text2)",
                            marginTop: 2,
                          }}
                        >
                          {p?.psu_id} · {p?.major} · {p?.year}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: isNext
                              ? "rgba(255,255,255,0.4)"
                              : "var(--text3)",
                          }}
                        >
                          {timeAgo(r.signed_in_at)}
                        </span>
                        {isNext && (
                          <span className="pill pill-gold">Take photo →</span>
                        )}
                        <button
                          className="delete-btn"
                          onClick={(e) => deleteAttendance(r.id, e)}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {done.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop: 8 }}>
                  Photos taken
                </div>
                {done.map((r) => {
                  const p = r.pnms;
                  const [abg, atxt] = avatarColor(r.pnm_id);
                  const url = signed[p.photo_path];
                  return (
                    <div key={r.id} className="queue-item is-done">
                      <div
                        style={{
                          minWidth: 24,
                          textAlign: "center",
                          fontSize: 15,
                          color: "var(--green-text)",
                        }}
                      >
                        ✓
                      </div>
                      {url ? (
                        <img
                          src={url}
                          alt={fullName(p)}
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: "50%",
                            objectFit: "cover",
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          className="avatar"
                          style={{ background: abg, color: atxt }}
                        >
                          {initials(fullName(p))}
                        </div>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: "var(--text)" }}>
                          {fullName(p)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text2)",
                            marginTop: 2,
                          }}
                        >
                          {p?.major} · {p?.year}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span className="pill pill-green">Done</span>
                        <button
                          className="delete-btn"
                          onClick={(e) => deleteAttendance(r.id, e)}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
