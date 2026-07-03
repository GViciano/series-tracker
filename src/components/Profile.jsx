import { useEffect, useState } from 'react'
import { LogOut, Clock, CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getShowDetails } from '../lib/tmdb'
import { useAuth } from '../context/AuthContext'

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const DEFAULT_RUNTIME = 45 // minutos, si TMDB no da duración de episodio

function formatDuration(minutes) {
  const totalHours = minutes / 60
  const days = Math.floor(totalHours / 24)
  const hours = Math.round(totalHours - days * 24)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  return `${Math.round(minutes)}min`
}

export default function Profile({ onBack }) {
  const { user, signOut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [monthly, setMonthly] = useState([])
  const [yearly, setYearly] = useState([])
  const [totalMinutes, setTotalMinutes] = useState(0)
  const [totalEpisodes, setTotalEpisodes] = useState(0)

  useEffect(() => {
    loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    try {
      const { data: shows } = await supabase
        .from('tracked_shows')
        .select('id, tmdb_id, name')
        .eq('user_id', user.id)

      const { data: watched } = await supabase
        .from('watched_episodes')
        .select('tracked_show_id, watched_at')
        .eq('user_id', user.id)

      const showsById = {}
      shows?.forEach(s => { showsById[s.id] = s })

      // duración media de episodio por serie (solo para series con episodios vistos)
      const neededShowIds = [...new Set((watched || []).map(w => w.tracked_show_id))]
      const runtimeByShowId = {}
      await Promise.all(neededShowIds.map(async (showId) => {
        const show = showsById[showId]
        if (!show) { runtimeByShowId[showId] = DEFAULT_RUNTIME; return }
        try {
          const details = await getShowDetails(show.tmdb_id)
          runtimeByShowId[showId] = details.episode_run_time?.[0] || DEFAULT_RUNTIME
        } catch {
          runtimeByShowId[showId] = DEFAULT_RUNTIME
        }
      }))

      const monthMap = {}
      const yearMap = {}
      let totalMin = 0

      ;(watched || []).forEach(w => {
        const minutes = runtimeByShowId[w.tracked_show_id] || DEFAULT_RUNTIME
        totalMin += minutes
        const d = new Date(w.watched_at)
        const year = d.getFullYear()
        const month = d.getMonth()
        const mKey = `${year}-${String(month + 1).padStart(2, '0')}`

        if (!monthMap[mKey]) monthMap[mKey] = { key: mKey, year, month, minutes: 0, episodes: 0 }
        monthMap[mKey].minutes += minutes
        monthMap[mKey].episodes += 1

        if (!yearMap[year]) yearMap[year] = { year, minutes: 0, episodes: 0 }
        yearMap[year].minutes += minutes
        yearMap[year].episodes += 1
      })

      const monthlyArr = Object.values(monthMap)
        .map(m => ({ ...m, label: `${MONTH_NAMES[m.month]} ${m.year}` }))
        .sort((a, b) => b.key.localeCompare(a.key))
        .slice(0, 12)

      const yearlyArr = Object.values(yearMap).sort((a, b) => b.year - a.year)

      setMonthly(monthlyArr)
      setYearly(yearlyArr)
      setTotalMinutes(totalMin)
      setTotalEpisodes((watched || []).length)
    } finally {
      setLoading(false)
    }
  }

  const maxMonthMinutes = Math.max(1, ...monthly.map(m => m.minutes))

  return (
    <div className="profile-view">
      <div className="profile-header">
        <div className="profile-avatar">{user.email?.[0]?.toUpperCase()}</div>
        <strong>{user.email}</strong>
      </div>

      {loading ? (
        <p className="search-empty">Calculando estadísticas...</p>
      ) : totalEpisodes === 0 ? (
        <div className="empty-state">
          <span className="emoji">📊</span>
          Aún no tienes episodios marcados como vistos.
        </div>
      ) : (
        <>
          <div className="stats-summary">
            <div className="stat-box">
              <span className="stat-value">{totalEpisodes}</span>
              <span className="stat-label">Episodios vistos</span>
            </div>
            <div className="stat-box">
              <span className="stat-value">{formatDuration(totalMinutes)}</span>
              <span className="stat-label">Tiempo total</span>
            </div>
          </div>

          <h3 className="section-title"><Clock size={14} /> Por mes</h3>
          <div className="stats-list">
            {monthly.map(m => (
              <div key={m.key} className="stats-row">
                <span className="stats-row-label">{m.label}</span>
                <div className="stats-bar-track">
                  <div className="stats-bar-fill" style={{ width: `${(m.minutes / maxMonthMinutes) * 100}%` }} />
                </div>
                <span className="stats-row-value">{formatDuration(m.minutes)}</span>
              </div>
            ))}
          </div>

          <h3 className="section-title"><CalendarDays size={14} /> Por año</h3>
          <div className="stats-list">
            {yearly.map(y => (
              <div key={y.year} className="stats-row">
                <span className="stats-row-label">{y.year}</span>
                <span className="stats-row-value">{y.episodes} episodios · {formatDuration(y.minutes)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="logout-btn" onClick={signOut}>
        <LogOut size={16} /> Cerrar sesión
      </button>
    </div>
  )
}
