import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { initials, avatarColor } from '../lib/utils'
import { NavBar } from './Kiosk'
import { fireConfetti } from '../lib/confetti'

export default function Camera() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const rusheeId = searchParams.get('id')

  const [rushee, setRushee]       = useState(null)
  const [checkin, setCheckin]     = useState(null)
  const [waiting, setWaiting]     = useState([])
  const [stream, setStream]       = useState(null)
  const [captured, setCaptured]   = useState(null)
  const [uploading, setUploading] = useState(false)
  const [camError, setCamError]   = useState(null)
  const [successName, setSuccessName] = useState(null)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const confirmBtnRef = useRef(null)

  useEffect(() => {
    async function load() {
      const { data: checkins } = await supabase
        .from('checkins')
        .select('id, rushee_id, flagged, photo_url, rushees(name, major, year, id)')
        .is('photo_url', null)
        .order('checked_in_at', { ascending: true })
      setWaiting(checkins || [])
      if (rusheeId) {
        const target = (checkins || []).find(c => c.rushee_id === rusheeId)
        if (target) { setCheckin(target); setRushee(target.rushees) }
      } else if (checkins && checkins.length > 0) {
        setCheckin(checkins[0]); setRushee(checkins[0].rushees)
      }
    }
    load()
  }, [rusheeId])

  useEffect(() => { if (stream && videoRef.current) videoRef.current.srcObject = stream }, [stream])
  useEffect(() => () => { if (stream) stream.getTracks().forEach(t => t.stop()) }, [stream])
  useEffect(() => { setCaptured(null); setCamError(null); if (stream) { stream.getTracks().forEach(t => t.stop()); setStream(null) } }, [checkin?.id])

  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment', width:{ ideal:1280 }, height:{ ideal:960 } }, audio:false })
      setStream(s); setCamError(null)
    } catch { setCamError('Camera unavailable — use "Upload photo" below.') }
  }

  function snap() {
    const video = videoRef.current, canvas = canvasRef.current
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setCaptured(canvas.toDataURL('image/jpeg', 0.85))
    stream.getTracks().forEach(t => t.stop()); setStream(null)
  }

  function retake() { setCaptured(null); startCamera() }
  function handleUpload(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCaptured(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function confirm(e) {
    if (!checkin || !captured) return
    setUploading(true)
    const res = await fetch(captured)
    const blob = await res.blob()
    const path = `${checkin.rushee_id}_${Date.now()}.jpg`
    const { error: uploadErr } = await supabase.storage.from('photos').upload(path, blob, { contentType:'image/jpeg', upsert:true })
    if (uploadErr) { alert('Upload failed: ' + uploadErr.message); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
    await supabase.from('checkins').update({ photo_url: publicUrl }).eq('id', checkin.id)

    // Fire confetti from button position
    if (e?.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect()
      fireConfetti(rect.left + rect.width / 2, rect.top)
    }

    setSuccessName(rushee?.name)
    setCaptured(null); setUploading(false)
    setTimeout(() => {
      setSuccessName(null)
      const remaining = waiting.filter(c => c.rushee_id !== checkin.rushee_id)
      if (remaining.length > 0) navigate(`/camera?id=${remaining[0].rushee_id}`)
      else navigate('/queue')
    }, 1800)
  }

  const nextUp = waiting.find(c => c.rushee_id !== rusheeId)

  if (!rushee && waiting.length === 0) {
    return (
      <div className="page">
        <NavBar waitingCount={0} />
        <div className="content" style={{ maxWidth:500, margin:'0 auto', textAlign:'center', paddingTop:60 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>✓</div>
          <div style={{ fontWeight:700, fontSize:18, marginBottom:8, color:'var(--navy)' }}>Queue is empty</div>
          <div style={{ fontSize:13, color:'var(--text2)', marginBottom:20 }}>All photos taken, or no one has checked in yet.</div>
          <button className="btn btn-navy" onClick={() => navigate('/queue')}>Back to queue</button>
        </div>
      </div>
    )
  }

  const [abg, atxt] = rushee ? avatarColor(rushee.id) : ['#eee','#333']

  return (
    <div className="page">
      <NavBar waitingCount={waiting.length} />
      <div className="content" style={{ maxWidth:520, margin:'0 auto', width:'100%' }}>

        {rushee && (
          <div className="banner banner-navy" style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, borderLeft:`4px solid var(--gold)` }}>
            <div className="avatar" style={{ background:'rgba(245,184,0,0.15)', color:'var(--gold)', border:'2px solid var(--gold)', width:44, height:44, fontSize:14 }}>
              {initials(rushee.name)}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:15, color:'var(--gold)' }}>{rushee.name}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.6)', marginTop:2 }}>{rushee.id} · {rushee.major} · {rushee.year}</div>
            </div>
            {checkin?.flagged && <span className="pill pill-amber">Verify ID</span>}
            <div style={{ textAlign:'right', fontSize:12, color:'rgba(255,255,255,0.4)' }}>{waiting.length - 1} more waiting</div>
          </div>
        )}

        {successName && (
          <div className="banner banner-gold" style={{ marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:18 }}>✓</span> Photo saved for {successName} — loading next person...
          </div>
        )}

        <canvas ref={canvasRef} style={{ display:'none' }} />
        <div className="card" style={{ padding:0, overflow:'hidden', borderTop:`3px solid var(--gold)` }}>
          {captured ? (
            <>
              <img src={captured} alt="Preview" style={{ width:'100%', display:'block', maxHeight:380, objectFit:'cover' }} />
              <div style={{ display:'flex', gap:8, padding:12 }}>
                <button className="btn" style={{ flex:1 }} onClick={retake} disabled={uploading}>Retake</button>
                <button ref={confirmBtnRef} className="btn btn-gold" style={{ flex:2 }} onClick={confirm} disabled={uploading}>
                  {uploading ? 'Saving...' : '✓ Use this photo'}
                </button>
              </div>
            </>
          ) : stream ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted style={{ width:'100%', display:'block', maxHeight:380, objectFit:'cover' }} />
              <div style={{ padding:12 }}>
                <button className="btn btn-navy" style={{ width:'100%', padding:'11px 0', fontSize:15 }} onClick={snap}>Take photo</button>
              </div>
            </>
          ) : (
            <div style={{ padding:32, textAlign:'center' }}>
              {camError && <div className="banner banner-amber" style={{ marginBottom:16, textAlign:'left' }}>{camError}</div>}
              <button className="btn btn-navy" style={{ width:'100%', padding:'11px 0', marginBottom:12 }} onClick={startCamera}>Open camera</button>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>or upload for demo</div>
              <label className="btn" style={{ display:'inline-block', cursor:'pointer' }}>
                Upload photo
                <input type="file" accept="image/*" capture="environment" onChange={handleUpload} style={{ display:'none' }} />
              </label>
            </div>
          )}
        </div>

        {nextUp && (
          <div style={{ marginTop:10, padding:'10px 14px', background:'var(--bg)', border:'0.5px solid var(--border)', borderRadius:'var(--radius)', fontSize:13, color:'var(--text2)', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ color:'var(--text3)', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>Next up:</span>
            <strong style={{ color:'var(--text)' }}>{nextUp.rushees?.name}</strong>
            <span style={{ color:'var(--text3)' }}>· {nextUp.rushees?.major}</span>
          </div>
        )}

        {waiting.length > 1 && (
          <div style={{ marginTop:10 }}>
            <div className="section-label" style={{ marginBottom:6 }}>Others waiting</div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {waiting.filter(c => c.rushee_id !== rusheeId).slice(0, 3).map(c => (
                <div key={c.id} onClick={() => navigate(`/camera?id=${c.rushee_id}`)}
                  style={{ padding:'8px 12px', background:'var(--bg)', border:'0.5px solid var(--border)', borderRadius:'var(--radius)', cursor:'pointer', fontSize:13, color:'var(--text2)', display:'flex', justifyContent:'space-between' }}>
                  <span>{c.rushees?.name}</span>
                  <span style={{ color:'var(--text3)' }}>{c.rushees?.major}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
