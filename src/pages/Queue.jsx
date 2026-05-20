import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { timeAgo, initials, avatarColor } from '../lib/utils'
import { NavBar } from './Kiosk'
import { fireConfetti } from '../lib/confetti'

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.exiting ? 'exiting' : ''}`}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Just checked in</div>
          <div className="toast-name">{t.name}</div>
          <div className="toast-meta">{t.major} · {t.year}</div>
        </div>
      ))}
    </div>
  )
}

export default function Queue() {
  const [checkins, setCheckins] = useState([])
  const [loading, setLoading]   = useState(true)
  const [toasts, setToasts]     = useState([])
  const [newIds, setNewIds]     = useState(new Set())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const prevIds = useRef(new Set())
  const navigate = useNavigate()

  async function load() {
    const { data } = await supabase
      .from('checkins')
      .select('id, rushee_id, checked_in_at, flagged, photo_url, rushees(name, major, year, id)')
      .order('checked_in_at', { ascending: true })
    setCheckins(data || [])
    setLoading(false)
    return data || []
  }

  useEffect(() => {
    load()
    const channel = supabase.channel('checkins-queue')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checkins' }, async payload => {
        const data = await load()
        const newEntry = data.find(c => c.rushee_id === payload.new.rushee_id)
        if (newEntry?.rushees) {
          const r = newEntry.rushees
          const toastId = Date.now()
          setToasts(prev => [...prev, { id: toastId, name: r.name, major: r.major, year: r.year }])
          setNewIds(prev => new Set([...prev, payload.new.rushee_id]))
          setTimeout(() => setNewIds(prev => { const s = new Set(prev); s.delete(payload.new.rushee_id); return s }), 1000)
          setTimeout(() => setToasts(prev => prev.map(t => t.id === toastId ? { ...t, exiting: true } : t)), 3500)
          setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toastId)), 3900)
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checkins' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  async function deleteCheckin(checkinId, rusheeId, e) {
    e.stopPropagation()
    if (!confirm('Remove this person from the check-in list?')) return
    await supabase.from('checkins').delete().eq('id', checkinId)
    load()
  }

  const waiting = checkins.filter(c => !c.photo_url)
  const done    = checkins.filter(c =>  c.photo_url)

  return (
    <div className="page">
      <NavBar waitingCount={waiting.length} />
      <Toast toasts={toasts} />
      <div className="content" style={{ maxWidth:640, margin:'0 auto', width:'100%' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div className="stat-grid" style={{ flex:1, marginBottom:0 }}>
            <div className="stat-card"><div className="stat-num">{waiting.length}</div><div className="stat-label">Waiting</div></div>
            <div className="stat-card"><div className="stat-num">{done.length}</div><div className="stat-label">Photos taken</div></div>
            <div className="stat-card"><div className="stat-num">{checkins.length}</div><div className="stat-label">Total checked in</div></div>
          </div>
          <button className="fullscreen-btn" onClick={toggleFullscreen} style={{ marginLeft:12, whiteSpace:'nowrap', background:'var(--navy)', color:'rgba(255,255,255,0.7)', border:'1px solid rgba(255,255,255,0.15)', padding:'8px 12px', borderRadius:'var(--radius)', fontSize:12, fontWeight:500 }}>
            {isFullscreen ? '⤡ Exit' : '⤢ Fullscreen'}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign:'center', padding:40, color:'var(--text3)', fontSize:13 }}>Loading...</div>
        ) : checkins.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'var(--text3)', fontSize:13 }}>
            No one checked in yet
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {waiting.length > 0 && (
              <>
                <div className="section-label">Waiting for photo</div>
                {waiting.map((c, i) => {
                  const r = c.rushees
                  const isNext = i === 0
                  const [abg, atxt] = avatarColor(c.rushee_id)
                  const isNew = newIds.has(c.rushee_id)
                  return (
                    <div key={c.id} className={`queue-item ${isNext ? 'is-next' : ''} ${isNew ? 'new-entry' : ''}`}
                      onClick={() => navigate(`/camera?id=${c.rushee_id}`)}
                      style={{ cursor:'pointer' }}>
                      <div style={{ minWidth:24, textAlign:'center', fontSize:15, fontWeight:700, color: isNext ? 'var(--gold)' : 'var(--text3)' }}>
                        {i + 1}
                      </div>
                      <div className="avatar" style={{ background: isNext ? 'rgba(245,184,0,0.15)' : abg, color: isNext ? 'var(--gold)' : atxt, border: isNext ? '2px solid var(--gold)' : 'none' }}>
                        {initials(r?.name || '?')}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, color: isNext ? 'var(--gold)' : 'var(--text)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                          {r?.name}
                          {isNext && <span style={{ fontSize:11, fontWeight:400, color:'rgba(245,184,0,0.7)' }}>— tap to photograph</span>}
                          {c.flagged && <span className="pill pill-amber">ID flagged</span>}
                        </div>
                        <div style={{ fontSize:12, color: isNext ? 'rgba(255,255,255,0.6)' : 'var(--text2)', marginTop:2 }}>
                          {c.rushee_id} · {r?.major} · {r?.year}
                        </div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:12, color: isNext ? 'rgba(255,255,255,0.4)' : 'var(--text3)' }}>{timeAgo(c.checked_in_at)}</span>
                        {isNext && <span className="pill pill-gold">Take photo →</span>}
                        <button className="delete-btn" onClick={e => deleteCheckin(c.id, c.rushee_id, e)} title="Remove">✕</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}

            {done.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop:8 }}>Photos taken</div>
                {done.map(c => {
                  const r = c.rushees
                  const [abg, atxt] = avatarColor(c.rushee_id)
                  return (
                    <div key={c.id} className="queue-item is-done">
                      <div style={{ minWidth:24, textAlign:'center', fontSize:15, color:'var(--green-text)' }}>✓</div>
                      {c.photo_url
                        ? <img src={c.photo_url} alt={r?.name} style={{ width:38, height:38, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                        : <div className="avatar" style={{ background:abg, color:atxt }}>{initials(r?.name || '?')}</div>
                      }
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:600, color:'var(--text)' }}>{r?.name}</div>
                        <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{r?.major} · {r?.year}</div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span className="pill pill-green">Done</span>
                        <button className="delete-btn" onClick={e => deleteCheckin(c.id, c.rushee_id, e)} title="Remove">✕</button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
