import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Sheet from "./Sheet";
import {
  getEventId,
  getEventLabel,
  getStationId,
  getSide,
  saveStation,
  signOutStation,
} from "./AuthGate";

// Station settings sheet shared by the sign-in kiosk and the photo queue:
// station name, side and event (same storage keys as the setup screen),
// plus navigation, fullscreen and sign-out. `onSaved({ side, eventChanged })`
// lets the host page navigate and reload.
export default function StationControls({
  open,
  onClose,
  onSaved,
  title = "Station settings",
  links = [], // [{ to, label, hint }]
  note,
}) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [events, setEvents] = useState(null); // null = loading
  const [eventsError, setEventsError] = useState(false);
  const [formStation, setFormStation] = useState("");
  const [formSide, setFormSide] = useState("");
  const [formEvent, setFormEvent] = useState(null); // { id, label }
  const [formError, setFormError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canFullscreen =
    typeof document !== "undefined" &&
    !!document.fullscreenEnabled &&
    !!document.documentElement.requestFullscreen;

  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function loadEvents() {
    setEventsError(false);
    const { data, error } = await supabase
      .from("rush_events")
      .select("id, label, iso_date")
      .order("iso_date", { ascending: true });
    if (error) {
      setEventsError(true);
      return;
    }
    setEvents(data || []);
  }

  // Reset the form to the stored configuration each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    const id = getEventId();
    setFormStation(getStationId() === "unnamed" ? "" : getStationId());
    setFormSide(getSide() || "");
    setFormEvent(id ? { id, label: getEventLabel() } : null);
    setFormError("");
    setConfirmSignOut(false);
    loadEvents();
  }, [open]);

  function toggleFullscreen() {
    if (!canFullscreen) return;
    if (!document.fullscreenElement)
      document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  function save() {
    if (!formStation.trim()) return setFormError("Name this station.");
    if (!formSide) return setFormError("Pick a side.");
    if (!formEvent) return setFormError("Pick an event.");
    const eventChanged = formEvent.id !== getEventId();
    saveStation({
      eventId: formEvent.id,
      eventLabel: formEvent.label,
      station: formStation,
      side: formSide,
    });
    onClose();
    onSaved?.({ side: formSide, eventChanged });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={confirmSignOut ? "Sign this station out?" : title}
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
        <form
          className="q-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
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
              Sign-in laptops and the photographer on the same side must match.
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
                  onClick={loadEvents}
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
                        {tonight
                          ? `Tonight · ${ev.iso_date}`
                          : ev.iso_date || "no date"}
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
              type="submit"
              className="q-btn q-btn-primary q-btn-block q-btn-lg"
            >
              Save
            </button>
            <button
              type="button"
              className="q-btn q-btn-secondary q-btn-block"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>

          <div className="q-sheet-more">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="q-btn q-btn-navy q-btn-block"
                onClick={onClose}
              >
                {l.label}
                {l.hint != null && (
                  <span className="q-tab-count">{l.hint}</span>
                )}
              </Link>
            ))}
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
            {note && <p className="q-settings-note">{note}</p>}
            <button
              type="button"
              className="q-btn q-btn-quiet"
              onClick={() => setConfirmSignOut(true)}
            >
              Sign out this station
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
