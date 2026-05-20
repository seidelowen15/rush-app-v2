import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const LOGO_URL = 'https://zrcmqwysjmyyjscxkbfb.supabase.co/storage/v1/object/public/photos/akpsi-logo.png'
const EVENT_NAME = 'Fall Rush 2026 — Speed Dating'

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior']
const MAJORS = [
  'Accounting','Actuarial Science','Advertising/PR','Aerospace Engineering',
  'African American Studies','Agricultural Science','Architecture','Art',
  'Biochemistry','Biology','Biomedical Engineering','Business',
  'Chemical Engineering','Chemistry','Civil Engineering','Communications',
  'Computer Engineering','Computer Science','Criminal Justice',
  'Economics','Education','Electrical Engineering','Engineering',
  'English','Environmental Science','Finance','Food Science',
  'Geography','Graphic Design','Health Policy & Administration',
  'History','Hospitality Management','Human Development & Family Studies',
  'Industrial Engineering','Information Sciences & Technology','IST',
  'Kinesiology','Labor & Employment Relations','Landscape Architecture',
  'Marketing','Math','Mechanical Engineering','Media Studies',
  'Meteorology','Music','Nursing','Nutrition','Philosophy',
  'Physics','Political Science','Psychology','Recreation',
  'Security & Risk Analysis','Sociology','Spanish','Supply Chain',
  'Statistics','Theatre','Undecided','Other',
]

export function NavBar({ waitingCount }) {
  const loc = useLocation()
  return (
    <div className="topbar">
      <Link to="/kiosk" className="topbar-brand">
        <span>AKΨ</span>
      </Link>
      <div className="topbar-event">{EVENT_NAME}</div>
      <Link to="/kiosk" className={`nav-link ${loc.pathname === '/kiosk' ? 'active' : ''}`}>Sign-in kiosk</Link>
      <Link to="/queue" className={`nav-link ${loc.pathname === '/queue' ? 'active' : ''}`}>
        Photo queue
        {waitingCount > 0 && <span className="badge">{waitingCount}</span>}
      </Link>
    </div>
  )
}

function StatCard({ label, value }) {
  const [display, setDisplay] = useState(value)
  const [bump, setBump] = useState(false)
  const prev = useRef(value)
  useEffect(() => {
    if (value !== prev.current) {
      setBump(true)
      setTimeout(() => setBump(false), 350)
      prev.current = value
    }
    setDisplay(value)
  }, [value])
  return (
    <div className="stat-card">
      <div className={`stat-num ${bump ? 'bump' : ''}`}>{display}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export default function Kiosk() {
  const [checkedInIds, setCheckedInIds] = useState(new Set())
  const [waitingCount, setWaitingCount] = useState(0)
  const [doneCount, setDoneCount]       = useState(0)
  const [psuId,     setPsuId]     = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [year,      setYear]      = useState('')
  const [major,     setMajor]     = useState('')
  const [majorSearch, setMajorSearch] = useState('')
  const [showMajorList, setShowMajorList] = useState(false)
  const [step,      setStep]      = useState('id')
  const [flash,     setFlash]     = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [idError,   setIdError]   = useState('')
  const [existingRushee, setExistingRushee] = useState(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('checkins').select('rushee_id, photo_url')
      const ids = new Set((data || []).map(c => c.rushee_id))
      setCheckedInIds(ids)
      setWaitingCount((data || []).filter(c => !c.photo_url).length)
      setDoneCount((data || []).filter(c => c.photo_url).length)
    }
    load()
    const channel = supabase.channel('checkins-kiosk')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checkins' }, payload => {
        setCheckedInIds(prev => new Set([...prev, payload.new.rushee_id]))
        setWaitingCount(c => c + 1)
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'checkins' }, () => { load() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'checkins' }, payload => {
        if (payload.new.photo_url) { setWaitingCount(c => Math.max(0, c - 1)); setDoneCount(c => c + 1) }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  function resetForm() {
    setPsuId(''); setFirstName(''); setLastName('')
    setYear(''); setMajor(''); setMajorSearch('')
    setStep('id'); setIdError(''); setExistingRushee(null); setSubmitting(false)
  }

  async function handleIdNext() {
    const id = psuId.toLowerCase().trim()
    if (!id) return
    setIdError('')
    if (checkedInIds.has(id)) { setIdError('This ID has already checked in today.'); return }
    const { data } = await supabase.from('rushees').select('*').eq('id', id).single()
    if (data) { setExistingRushee(data); setStep('confirm') }
    else setStep('form')
  }

  async function handleConfirmExisting() {
    setSubmitting(true)
    await supabase.from('checkins').insert({ rushee_id: existingRushee.id, flagged: false })
    setFlash(existingRushee.name)
    resetForm()
    setTimeout(() => setFlash(null), 3500)
  }

  async function handleSubmitNew() {
    const id = psuId.toLowerCase().trim()
    const name = `${firstName.trim()} ${lastName.trim()}`
    if (!firstName.trim() || !lastName.trim() || !year || !major) return
    setSubmitting(true)
    await supabase.from('rushees').upsert({ id, name, major, year })
    await supabase.from('checkins').insert({ rushee_id: id, flagged: false })
    setFlash(name)
    resetForm()
    setTimeout(() => setFlash(null), 3500)
  }

  const filteredMajors = MAJORS.filter(m => m.toLowerCase().includes(majorSearch.toLowerCase()))
  const inputStyle = { width:'100%', padding:'11px 13px', borderRadius:'var(--radius)', border:'1.5px solid var(--border2)', background:'var(--bg)', color:'var(--text)', outline:'none', fontSize:15, fontFamily:'inherit', transition:'border-color .15s' }
  const labelStyle = { fontSize:12, fontWeight:600, color:'var(--text2)', marginBottom:5, display:'block', textTransform:'uppercase', letterSpacing:'0.04em' }

  return (
    <div className="page">
      <NavBar waitingCount={waitingCount} />
      <div className="content" style={{ maxWidth:480, margin:'0 auto', width:'100%' }}>
        <div className="stat-grid">
          <StatCard label="Checked in"       value={checkedInIds.size} />
          <StatCard label="Waiting for photo" value={waitingCount} />
          <StatCard label="Photos done"       value={doneCount} />
        </div>

        {flash && (
          <div className="banner banner-gold" style={{ marginBottom:14, fontSize:14, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:18 }}>✓</span> {flash} checked in and added to photo queue
          </div>
        )}

        <div className="card" style={{ display:'flex', flexDirection:'column', gap:14, borderTop:`3px solid var(--gold)` }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--navy)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Rush sign-in
          </div>

          <div>
            <label style={labelStyle}>PSU ID</label>
            <input style={inputStyle} value={psuId}
              onChange={e => { setPsuId(e.target.value); setIdError('') }}
              onKeyDown={e => e.key === 'Enter' && handleIdNext()}
              placeholder="e.g. abc1234" autoComplete="off" spellCheck={false} autoFocus
              disabled={step !== 'id'} />
            {idError && <div style={{ fontSize:13, color:'var(--red-text)', marginTop:6 }}>{idError}</div>}
            {step === 'id' && (
              <button className="btn btn-navy" style={{ width:'100%', marginTop:10, padding:'11px 0' }}
                onClick={handleIdNext} disabled={psuId.length < 3}>
                Continue →
              </button>
            )}
          </div>

          {step === 'confirm' && existingRushee && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div className="banner banner-navy" style={{ borderLeft:`4px solid var(--gold)` }}>
                <div style={{ fontWeight:600, marginBottom:2, color:'var(--gold)' }}>Welcome back, {existingRushee.name}</div>
                <div style={{ fontSize:12, opacity:0.8 }}>{existingRushee.major} · {existingRushee.year}</div>
              </div>
              <button className="btn btn-gold" style={{ width:'100%', padding:'11px 0' }}
                onClick={handleConfirmExisting} disabled={submitting}>
                {submitting ? 'Checking in...' : '✓ Check in'}
              </button>
              <button className="btn" style={{ width:'100%', padding:'9px 0' }} onClick={resetForm}>Not me — go back</button>
            </div>
          )}

          {step === 'form' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div>
                  <label style={labelStyle}>First name</label>
                  <input style={inputStyle} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First" autoFocus />
                </div>
                <div>
                  <label style={labelStyle}>Last name</label>
                  <input style={inputStyle} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last" />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Year</label>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
                  {YEARS.map(y => (
                    <button key={y} onClick={() => setYear(y)} style={{
                      padding:'9px 0', borderRadius:'var(--radius)', fontSize:13, fontWeight:600,
                      border:`1.5px solid ${year === y ? 'var(--navy)' : 'var(--border2)'}`,
                      background: year === y ? 'var(--navy)' : 'var(--bg2)',
                      color: year === y ? 'var(--gold)' : 'var(--text2)',
                      transition:'all .15s',
                    }}>{y}</button>
                  ))}
                </div>
              </div>

              <div style={{ position:'relative' }}>
                <label style={labelStyle}>Major</label>
                <input style={inputStyle}
                  value={major || majorSearch}
                  onChange={e => { setMajorSearch(e.target.value); setMajor(''); setShowMajorList(true) }}
                  onFocus={() => setShowMajorList(true)}
                  placeholder="Search or type major..." />
                {showMajorList && (majorSearch || !major) && (
                  <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:20, background:'var(--bg)', border:'1px solid var(--border2)', borderRadius:'var(--radius)', maxHeight:180, overflowY:'auto', marginTop:2, boxShadow:'0 4px 16px rgba(30,58,110,0.15)' }}>
                    {filteredMajors.map(m => (
                      <div key={m} onClick={() => { setMajor(m); setMajorSearch(''); setShowMajorList(false) }}
                        style={{ padding:'9px 12px', cursor:'pointer', fontSize:13, color:'var(--text)', borderBottom:'0.5px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        {m}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button className="btn btn-gold" style={{ width:'100%', padding:'12px 0', fontSize:15, marginTop:2 }}
                onClick={handleSubmitNew}
                disabled={submitting || !firstName.trim() || !lastName.trim() || !year || !major}>
                {submitting ? 'Submitting...' : 'Submit & check in'}
              </button>
              <button className="btn" style={{ width:'100%', padding:'9px 0' }} onClick={resetForm}>← Go back</button>
            </div>
          )}
        </div>

        <div style={{ marginTop:12, fontSize:12, color:'var(--text3)', textAlign:'center' }}>
          All 6 kiosk stations share the same live database.
        </div>
      </div>
    </div>
  )
}
