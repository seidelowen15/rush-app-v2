import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { timeAgo, initials, avatarColor } from "../lib/utils";
import { BRAND } from "../lib/brand";
import {
  getEventId,
  getEventLabel,
  getStationId,
  getSide,
  getSideLabel,
  saveStation,
  signOutStation,
} from "../components/AuthGate";
import Sheet from "../components/Sheet";
import "../queue.css";

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

export default function Queue({ side }) {
  const eventId = getEventId();
  const [allRows, setAllRows] = useState([]);
  const [signed, setSigned] = useState({}); // photo_path -> signed url
  const signedExp = useRef({}); // photo_path -> epoch ms expiry
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [newIds, setNewIds] = useState(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [announce, setAnnounce] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null); // { id, name }
  const [stationOpen, setStationOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [events, setEvents] = useState(null); // null = not loaded yet
  const [eventsError, setEventsError] = useState(false);
  const [formStation, setFormStation] = useState("");
  const [formSide, setFormSide] = useState("");
  const [formEvent, setFormEvent] = useState(null); // { id, label }
  const [formError, setFormError] = useState("");
  const navigate = useNavigate();
  const canFullscreen =
    typeof document !== "undefined" &&
    !!document.fullscreenEnabled &&
    !!document.documentElement.requestFullscreen;

  const fullName = (p) => (p ? `${p.first_name} ${p.last_name}` : "?");
  const rows = allRows.filter((r) => r.side === side);

  async function load() {
    if (!eventId) {
      setLoading(false);
      return [];
    }
    const { data, error } = await supabase
      .from("attendance")
      .select(
        "id, pnm_id, signed_in_at, station_id, side, pnms(id, psu_id, first_name, last_name, major, year, psu_id_unverified, photo_path)",
      )
      .eq("event_id", eventId)
      .order("signed_in_at", { ascending: true });

    if (error) {
      console.error("queue load failed", error);
      setLoadError(true);
      setLoading(false);
      return [];
    }
    const list = data || [];
    setLoadError(false);
    setAllRows(list);
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
          if (payload.new.side !== side) return;
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
        // Supabase realtime cannot filter DELETE events; a filtered DELETE
        // subscription never fires. Reload on any attendance delete.
        { event: "DELETE", schema: "public", table: "attendance" },
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
    // iOS suspends the tab (and its realtime socket) when the phone locks or
    // switches apps. Re-pull the moment the page is visible again so the queue
    // is current without a page reload.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
      supabase.removeChannel(channel);
    };
  }, [eventId, side]);

  // iPhone Safari has no page fullscreen; the control is hidden there
  // (canFullscreen) rather than offered and silently failing.
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  function toggleFullscreen() {
    if (!canFullscreen) return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openCamera(pnmId) {
    // Carry the side so the camera loads THIS queue, not the station's side.
    navigate(`/camera?id=${pnmId}&side=${side}`);
  }

  // Removes the check-in for THIS event only. The pnms row and any photo are
  // left alone -- the person still exists and may have attended other nights.
  // Opens our own confirm sheet; the delete runs from confirmRemove().
  function deleteAttendance(attendanceId, name) {
    setRemoveError(null);
    setPendingRemove({ id: attendanceId, name });
  }

  async function confirmRemove() {
    if (!pendingRemove || removingId) return;
    const { id: attendanceId, name } = pendingRemove;
    setRemovingId(attendanceId);
    const { error } = await supabase
      .from("attendance")
      .delete()
      .eq("id", attendanceId);
    setRemovingId(null);
    setPendingRemove(null);
    if (error) {
      setRemoveError(`Couldn't remove ${name}: ${error.message}`);
      setAnnounce(`Remove failed for ${name}.`);
    } else {
      setAnnounce(`${name} removed from the ${side} queue.`);
    }
    load();
  }

  async function openStation() {
    setFormStation(getStationId() === "unnamed" ? "" : getStationId());
    setFormSide(getSide() || side);
    setFormEvent(eventId ? { id: eventId, label: getEventLabel() } : null);
    setFormError("");
    setConfirmSignOut(false);
    setStationOpen(true);
    const { data, error } = await supabase
      .from("rush_events")
      .select("id, label, iso_date")
      .order("iso_date", { ascending: true });
    if (error) {
      setEventsError(true);
      return;
    }
    setEventsError(false);
    setEvents(data || []);
  }

  function saveStationForm() {
    if (!formStation.trim()) return setFormError("Name this station.");
    if (!formSide) return setFormError("Pick a side.");
    if (!formEvent) return setFormError("Pick an event.");
    const eventChanged = formEvent.id !== eventId;
    saveStation({
      eventId: formEvent.id,
      eventLabel: formEvent.label,
      station: formStation,
      side: formSide,
    });
    setStationOpen(false);
    if (eventChanged) {
      setAllRows([]);
      setLoading(true);
    }
    setAnnounce("Station settings saved.");
    // Same route if the side is unchanged; the effect keyed on eventId reloads.
    navigate(`/queue/${formSide}`, { replace: true });
  }

  const waiting = rows.filter((r) => !r.pnms?.photo_path);
  const done = rows.filter((r) => r.pnms?.photo_path);
  const waitingBySide = {
    left: allRows.filter((r) => r.side === "left" && !r.pnms?.photo_path).length,
    right: allRows.filter((r) => r.side === "right" && !r.pnms?.photo_path)
      .length,
  };
  const sideName = side === "left" ? "Left" : "Right";

  if (!eventId) {
    return (
      <div className="page">
        <div className="content">No event selected. Reload to set one.</div>
      </div>
    );
  }

  return (
    <div className="q-page">
      <header className="q-header">
        <div className="q-header-inner">
          <div className="q-brandrow">
            <span className="q-brandrow-left">
              <span className="q-mark" aria-hidden="true">
                {BRAND.mark}
              </span>
              <span>Photo queue</span>
            </span>
            <button
              type="button"
              className="q-station-btn"
              onClick={openStation}
              aria-haspopup="dialog"
            >
              <span aria-hidden="true">⚙</span> Station
            </button>
          </div>
          <h1 className="q-event">{getEventLabel()}</h1>
          <p className="q-station">
            Station {getStationId()} · {getSideLabel()} side
          </p>
          <nav className="q-tabs" aria-label="Queue side">
            {["left", "right"].map((s) => {
              const active = s === side;
              const label = s === "left" ? "Left queue" : "Right queue";
              return (
                <Link
                  key={s}
                  to={`/queue/${s}`}
                  className={`q-tab ${active ? "is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {label}
                  <span className="q-tab-count">
                    {waitingBySide[s]}
                    <span className="q-sr-only"> waiting for photo</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <Toast toasts={toasts} />
      <div className="q-sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      <main className="q-main">
        <section className="q-section" aria-label={`${sideName} queue totals`}>
          <div className="q-summary">
            <div className="q-metrics">
              <div className="q-metric">
                <span className="q-metric-num">{rows.length}</span>
                <span className="q-metric-label">Checked in</span>
              </div>
              <div className="q-metric">
                <span className="q-metric-num">{waiting.length}</span>
                <span className="q-metric-label">Waiting for photo</span>
              </div>
            </div>
            <button
              type="button"
              className="q-btn q-btn-secondary"
              onClick={refresh}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <span aria-hidden="true">↻</span>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <p className="q-scope">
            Counts for the {sideName} queue at this event.
          </p>
          {loadError && (
            <div className="q-alert" role="alert">
              <span className="q-alert-msg">
                Couldn't reach the server. The list may be out of date.
              </span>
              <button
                type="button"
                className="q-btn q-btn-secondary"
                onClick={refresh}
                disabled={refreshing}
              >
                Try again
              </button>
            </div>
          )}
          {removeError && (
            <div className="q-alert" role="alert">
              <span className="q-alert-msg">{removeError}</span>
              <button
                type="button"
                className="q-btn q-btn-secondary"
                onClick={() => setRemoveError(null)}
              >
                Dismiss
              </button>
            </div>
          )}
        </section>

        <section className="q-section" aria-labelledby="q-waiting-title">
          <div className="q-section-head">
            <h2 className="q-section-title" id="q-waiting-title">
              Waiting for photo
            </h2>
            {waiting.length > 0 && (
              <span className="q-section-count">{waiting.length}</span>
            )}
          </div>

          {loading ? (
            <div className="q-empty" aria-busy="true">
              Loading the {sideName.toLowerCase()} queue…
            </div>
          ) : waiting.length === 0 && loadError && rows.length === 0 ? null : waiting.length === 0 ? (
            <div className="q-empty">
              <div className="q-empty-title">
                {rows.length === 0 ? "No one checked in yet" : "All caught up"}
              </div>
              {rows.length === 0
                ? `New ${sideName.toLowerCase()}-side check-ins appear here automatically.`
                : "Everyone in this queue has a photo."}
            </div>
          ) : (
            <ol className="q-list">
              {waiting.map((r, i) => {
                const p = r.pnms;
                const name = fullName(p);
                const isNext = i === 0;
                const [abg, atxt] = avatarColor(r.pnm_id);
                return (
                  <li
                    key={r.id}
                    className={`q-card ${isNext ? "is-next" : ""} ${
                      newIds.has(r.pnm_id) ? "is-new" : ""
                    }`}
                  >
                    <div className="q-card-top">
                      {isNext ? (
                        <span className="q-upnext">
                          <span className="q-upnext-dot" aria-hidden="true" />
                          Up next · #{i + 1}
                        </span>
                      ) : (
                        <span className="q-pos">#{i + 1}</span>
                      )}
                      <span>Checked in {timeAgo(r.signed_in_at)}</span>
                    </div>
                    <div className="q-who">
                      <div
                        className="q-avatar"
                        style={{ background: abg, color: atxt }}
                        aria-hidden="true"
                      >
                        {initials(name)}
                      </div>
                      <div className="q-who-text">
                        <div className="q-name">{name}</div>
                        <div className="q-id">
                          <span>{p?.psu_id}</span>
                          {p?.psu_id_unverified && (
                            <span className="q-flag">ID flagged</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="q-meta">
                      {p?.major || "—"} · {p?.year || "—"}
                    </div>
                    <button
                      type="button"
                      className={`q-btn q-btn-block q-btn-lg ${
                        isNext ? "q-btn-primary" : "q-btn-outline"
                      }`}
                      onClick={() => openCamera(r.pnm_id)}
                      aria-label={`Take photo of ${name}`}
                    >
                      Take photo
                    </button>
                    <div className="q-card-remove">
                      <button
                        type="button"
                        className="q-btn q-btn-quiet"
                        onClick={() => deleteAttendance(r.id, name)}
                        disabled={removingId === r.id}
                        aria-label={`Remove ${name} from this event's check-ins`}
                      >
                        {removingId === r.id ? "Removing…" : "Remove from queue"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {done.length > 0 && (
          <section className="q-section" aria-labelledby="q-done-title">
            <div className="q-section-head">
              <h2 className="q-section-title" id="q-done-title">
                Photos taken
              </h2>
              <span className="q-section-count">{done.length}</span>
            </div>
            <ul className="q-done-list">
              {done.map((r) => {
                const p = r.pnms;
                const name = fullName(p);
                const [abg, atxt] = avatarColor(r.pnm_id);
                const url = signed[p.photo_path];
                return (
                  <li key={r.id} className="q-done-row">
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        className="q-avatar q-avatar-sm"
                      />
                    ) : (
                      <div
                        className="q-avatar q-avatar-sm"
                        style={{ background: abg, color: atxt }}
                        aria-hidden="true"
                      >
                        {initials(name)}
                      </div>
                    )}
                    <div className="q-done-main">
                      <div className="q-done-name">{name}</div>
                      <div className="q-done-meta">
                        {p?.major} · {p?.year}
                      </div>
                      <div className="q-done-status">
                        <span className="q-check" aria-hidden="true">
                          ✓
                        </span>
                        Photo taken
                      </div>
                    </div>
                    <button
                      type="button"
                      className="q-icon-btn"
                      onClick={() => deleteAttendance(r.id, name)}
                      disabled={removingId === r.id}
                      aria-label={`Remove ${name} from this event's check-ins`}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

      </main>

      <Sheet
        open={!!pendingRemove}
        onClose={() => setPendingRemove(null)}
        title={pendingRemove ? `Remove ${pendingRemove.name}?` : ""}
        role="alertdialog"
        busy={!!removingId}
      >
        <p className="q-sheet-text">
          This removes their check-in for {getEventLabel()} only. Their profile
          and any photo stay.
        </p>
        <div className="q-sheet-actions">
          <button
            type="button"
            className="q-btn q-btn-danger q-btn-block q-btn-lg"
            onClick={confirmRemove}
            disabled={!!removingId}
            aria-busy={!!removingId}
          >
            {removingId ? "Removing…" : "Yes, remove"}
          </button>
          <button
            type="button"
            className="q-btn q-btn-secondary q-btn-block q-btn-lg"
            onClick={() => setPendingRemove(null)}
            disabled={!!removingId}
            data-autofocus
          >
            Cancel
          </button>
        </div>
      </Sheet>

      <Sheet
        open={stationOpen}
        onClose={() => setStationOpen(false)}
        title={confirmSignOut ? "Sign this station out?" : "Station settings"}
      >
        {confirmSignOut ? (
          <>
            <p className="q-sheet-text">
              You'll need the shared kiosk login to sign back in.
            </p>
            <div className="q-sheet-actions">
              <button
                type="button"
                className="q-btn q-btn-danger q-btn-block q-btn-lg"
                onClick={signOutStation}
              >
                Yes, sign out
              </button>
              <button
                type="button"
                className="q-btn q-btn-secondary q-btn-block q-btn-lg"
                onClick={() => setConfirmSignOut(false)}
                data-autofocus
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="q-form">
            <label className="q-field">
              <span className="q-field-label">Station name</span>
              <input
                className="q-input"
                value={formStation}
                onChange={(e) => {
                  setFormStation(e.target.value);
                  setFormError("");
                }}
                placeholder="e.g. Front table 1"
                autoComplete="off"
              />
            </label>

            <fieldset className="q-field">
              <legend className="q-field-label">Side</legend>
              <div className="q-seg">
                {["left", "right"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`q-seg-btn ${formSide === s ? "is-active" : ""}`}
                    aria-pressed={formSide === s}
                    onClick={() => {
                      setFormSide(s);
                      setFormError("");
                    }}
                  >
                    {s === "left" ? "Left" : "Right"}
                  </button>
                ))}
              </div>
              <span className="q-field-hint">
                Sign-in laptops and the photographer on the same side must
                match.
              </span>
            </fieldset>

            <fieldset className="q-field">
              <legend className="q-field-label">Event</legend>
              {eventsError ? (
                <div className="q-alert" role="alert">
                  <span className="q-alert-msg">Couldn't load events.</span>
                  <button
                    type="button"
                    className="q-btn q-btn-secondary"
                    onClick={openStation}
                  >
                    Try again
                  </button>
                </div>
              ) : events === null ? (
                <span className="q-field-hint">Loading events…</span>
              ) : events.length === 0 ? (
                <span className="q-field-hint">No events found.</span>
              ) : (
                <div className="q-options">
                  {events.map((ev) => {
                    const tonight =
                      ev.iso_date === new Date().toLocaleDateString("en-CA");
                    const sel = formEvent?.id === ev.id;
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className={`q-option ${sel ? "is-active" : ""}`}
                        aria-pressed={sel}
                        onClick={() => {
                          setFormEvent({ id: ev.id, label: ev.label });
                          setFormError("");
                        }}
                      >
                        <span className="q-option-label">{ev.label}</span>
                        <span className="q-option-meta">
                          {tonight ? `Tonight · ${ev.iso_date}` : ev.iso_date || "no date"}
                        </span>
                        {sel && (
                          <span className="q-option-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {formError && (
              <div className="q-alert" role="alert">
                <span className="q-alert-msg">{formError}</span>
              </div>
            )}

            <div className="q-sheet-actions">
              <button
                type="button"
                className="q-btn q-btn-primary q-btn-block q-btn-lg"
                onClick={saveStationForm}
              >
                Save
              </button>
              <button
                type="button"
                className="q-btn q-btn-secondary q-btn-block"
                onClick={() => setStationOpen(false)}
              >
                Cancel
              </button>
            </div>

            <div className="q-sheet-more">
              <Link to="/kiosk" className="q-btn q-btn-navy q-btn-block">
                Open sign-in kiosk
              </Link>
              {canFullscreen ? (
                <button
                  type="button"
                  className="q-btn q-btn-secondary q-btn-block"
                  onClick={toggleFullscreen}
                  aria-pressed={isFullscreen}
                >
                  {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                </button>
              ) : (
                <p className="q-settings-note">
                  Fullscreen isn't available in this browser (iPhone Safari
                  doesn't support it).
                </p>
              )}
              <button
                type="button"
                className="q-btn q-btn-quiet"
                onClick={() => setConfirmSignOut(true)}
              >
                Sign out this station
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
