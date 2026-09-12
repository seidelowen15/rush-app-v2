import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// ---------------------------------------------------------------------------
// Shared kiosk context, read by Kiosk / Camera / Queue / Watch.
// Event and station are per-device and persist across reloads, so a browser
// refresh mid-event does not lose the station's identity.
// ---------------------------------------------------------------------------
const EVENT_KEY = "kiosk_event_id";
const EVENT_LABEL = "kiosk_event_label";
const STATION_KEY = "kiosk_station_id";
const SIDE_KEY = "kiosk_side";
const TIER_OK_KEY = "kiosk_tier_verified_v1";

export function getEventId() {
  return localStorage.getItem(EVENT_KEY);
}
export function getEventLabel() {
  return localStorage.getItem(EVENT_LABEL) || "No event selected";
}
export function getStationId() {
  return localStorage.getItem(STATION_KEY) || "unnamed";
}
export function getSide() {
  return localStorage.getItem(SIDE_KEY);
}
export function getSideLabel() {
  const s = getSide();
  return s === "left" ? "Left" : s === "right" ? "Right" : "No side";
}

export function clearEvent() {
  localStorage.removeItem(EVENT_KEY);
  localStorage.removeItem(EVENT_LABEL);
}

const box = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};
const card = {
  width: "100%",
  maxWidth: 380,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 24,
  borderRadius: "var(--radius)",
  border: "1px solid var(--border2)",
  background: "var(--bg)",
};
const input = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: "var(--radius)",
  border: "1.5px solid var(--border2)",
  background: "var(--bg)",
  color: "var(--text)",
  outline: "none",
  fontSize: 15,
  fontFamily: "inherit",
};
const label = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text2)",
  marginBottom: 5,
  display: "block",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export default function AuthGate({ children }) {
  const [phase, setPhase] = useState("loading"); // loading | signin | event | ready | denied
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [station, setStation] = useState(
    getStationId() === "unnamed" ? "" : getStationId(),
  );
  const [side, setSide] = useState(getSide() || "");

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setPhase("signin");
        return;
      }
      await afterAuth();
    } catch (e) {
      console.error("boot failed", e);
      setPhase("signin");
    }
  }

  // Confirms the signed-in account is actually the kiosk tier. A personal
  // account would pass sign-in but fail every kiosk policy at query time with
  // confusing empty results, so it is rejected here with a clear message.
  async function afterAuth() {
    const { data: sess } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("app_users")
      .select("tier")
      .eq("user_id", sess.session.user.id)
      .single();

    // A failed QUERY and a rejected ACCOUNT are different things. Offline the
    // query fails, and signing out here destroys the session that is the only
    // way back in.
    if (error) {
      if (localStorage.getItem(TIER_OK_KEY) === sess.session.user.id) {
        setPhase("ready");
        return;
      }
      setError(
        "Cannot reach the server, and this device has never been verified. Connect to the network and reload.",
      );
      setPhase("denied");
      return;
    }

    if (!data || data.tier !== "kiosk") {
      localStorage.removeItem(TIER_OK_KEY);
      setError(
        "This account is not a kiosk account. Sign in with the shared kiosk login.",
      );
      await supabase.auth.signOut();
      setPhase("signin");
      return;
    }

    localStorage.setItem(TIER_OK_KEY, sess.session.user.id);

    if (!(await validateStoredEvent()) || !getSide()) {
      await loadEvents();
      setPhase("event");
      return;
    }
    setPhase("ready");
  }

  // The stored event lives in localStorage indefinitely. Four events across four
  // days on the same tablets means a stale one silently records check-ins under
  // the wrong night -- returning PNMs hit attendance_unique_per_event and are
  // told they are already checked in, and new PNMs land on the wrong roster.
  // Returns true if the stored event is usable.
  async function validateStoredEvent() {
    const id = getEventId();
    if (!id) return false;

    const { data, error } = await supabase
      .from("rush_events")
      .select("id, label, iso_date")
      .eq("id", id)
      .maybeSingle();

    // Cannot check. Trust the stored event rather than stranding a station
    // mid-event over a dropped connection.
    if (error) {
      console.error("event validation unreachable", error);
      return true;
    }

    if (!data) {
      clearEvent();
      setError(
        "The event this station was set to no longer exists. Pick again.",
      );
      return false;
    }

    localStorage.setItem(EVENT_LABEL, data.label); // keep the label honest

    // en-CA gives YYYY-MM-DD in LOCAL time. Do not use toISOString() here --
    // rush events run in the evening in Eastern time, and after 8pm EDT the UTC
    // date is already tomorrow, which would reject every correct event.
    const today = new Date().toLocaleDateString("en-CA");
    if (data.iso_date && data.iso_date !== today) {
      clearEvent();
      setError(
        `This station was set to "${data.label}" (${data.iso_date}), which is not today. Pick tonight's event.`,
      );
      return false;
    }
    return true;
  }

  async function loadEvents() {
    const { data, error } = await supabase
      .from("rush_events")
      .select("id, key, label, iso_date")
      .order("iso_date", { ascending: true });
    if (error) {
      setError(error.message);
      return;
    }
    setEvents(data || []);
  }

  async function signIn() {
    setError("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword("");
      await afterAuth();
    } catch (e) {
      setError(e.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  function chooseEvent(ev) {
    if (!station.trim()) {
      setError("Name this station first.");
      return;
    }
    if (!side) {
      setError("Pick a side for this station.");
      return;
    }
    localStorage.setItem(EVENT_KEY, ev.id);
    localStorage.setItem(EVENT_LABEL, ev.label);
    localStorage.setItem(STATION_KEY, station.trim());
    localStorage.setItem(SIDE_KEY, side);
    setError("");
    setPhase("ready");
  }

  if (phase === "loading") {
    return (
      <div style={box}>
        <div style={{ color: "var(--text3)" }}>Loading…</div>
      </div>
    );
  }

  if (phase === "signin") {
    return (
      <div style={box}>
        <div style={card}>
          <div
            style={{
              fontWeight: 700,
              color: "var(--navy)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontSize: 12,
            }}
          >
            AKΨ Kiosk
          </div>
          <div style={{ fontSize: 13, color: "var(--text2)" }}>
            Sign in with the shared kiosk account.
          </div>
          {error && (
            <div style={{ fontSize: 13, color: "var(--red-text)" }}>
              {error}
            </div>
          )}
          <div>
            <label style={label}>Email</label>
            <input
              style={input}
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label style={label}>Password</label>
            <input
              style={input}
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
          </div>
          <button
            className="btn btn-navy"
            style={{ padding: "11px 0" }}
            onClick={signIn}
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "event") {
    return (
      <div style={box}>
        <div style={card}>
          <div
            style={{
              fontWeight: 700,
              color: "var(--navy)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontSize: 12,
            }}
          >
            Set up this station
          </div>
          {error && (
            <div style={{ fontSize: 13, color: "var(--red-text)" }}>
              {error}
            </div>
          )}
          <div>
            <label style={label}>Station name</label>
            <input
              style={input}
              value={station}
              placeholder="e.g. Front table 1"
              onChange={(e) => setStation(e.target.value)}
            />
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>
              Recorded on every check-in so a bad scan can be traced to a
              station.
            </div>
          </div>
          <div>
            <label style={label}>Side</label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {["left", "right"].map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  style={{
                    padding: "12px 0",
                    borderRadius: "var(--radius)",
                    fontSize: 14,
                    fontWeight: 700,
                    textTransform: "capitalize",
                    border: `2px solid ${side === s ? "var(--navy)" : "var(--border2)"}`,
                    background: side === s ? "var(--navy)" : "var(--bg2)",
                    color: side === s ? "var(--gold)" : "var(--text2)",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>
              Sign-in laptops and the photographer on the same side must match.
            </div>
          </div>
          <div>
            <label style={label}>Event</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {events.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>
                  No events found in rush_events.
                </div>
              )}
              {events.map((ev) => {
                const isToday =
                  ev.iso_date === new Date().toLocaleDateString("en-CA");
                return (
                  <button
                    key={ev.id}
                    className="btn"
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      border: isToday ? "2px solid var(--gold)" : undefined,
                    }}
                    onClick={() => chooseEvent(ev)}
                  >
                    <div style={{ fontWeight: 600 }}>{ev.label}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: isToday ? "var(--gold)" : "var(--text3)",
                      }}
                    >
                      {isToday
                        ? `Tonight · ${ev.iso_date}`
                        : ev.iso_date || "no date"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div style={box}>
        <div style={{ color: "var(--red-text)" }}>{error}</div>
      </div>
    );
  }

  return children;
}
