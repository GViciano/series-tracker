import { useEffect, useState } from 'react'
import { LogOut, CalendarDays, Upload, ChevronDown, RefreshCw, ShieldAlert } from 'lucide-react'
import { supabase, fetchAll } from '../lib/supabase'
import { getShowDetails, computeTotalEpisodes, posterUrl } from '../lib/tmdb'
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

export default function Profile({ onImport, onFixed, onSelectShow }) {
  const { user, signOut } = useAuth()
  const [loading, setLoading] = useState(true)
  const [monthsByYear, setMonthsByYear] = useState({}) // { year: [ {key, label, minutes, episodes, month} ] }
  const [yearly, setYearly] = useState([])
  const [totalMinutes, setTotalMinutes] = useState(0)
  const [totalEpisodes, setTotalEpisodes] = useState(0)
  const [expandedYear, setExpandedYear] = useState(null)
  const [recalculating, setRecalculating] = useState(false)
  const [recalcProgress, setRecalcProgress] = useState({ done: 0, total: 0 })
  const [recalcResult, setRecalcResult] = useState(null)
  const [auditing, setAuditing] = useState(false)
  const [auditProgress, setAuditProgress] = useState({ done: 0, total: 0 })
  const [auditResults, setAuditResults] = useState(null)


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

      // Supabase limita a 1000 filas por consulta — fetchAll pagina hasta traerlas todas
      const watched = await fetchAll(() =>
        supabase
          .from('watched_episodes')
          .select('tracked_show_id, watched_at')
          .eq('user_id', user.id)
      )

      const showsById = {}
      shows?.forEach(s => { showsById[s.id] = s })

      const neededShowIds = [...new Set(watched.map(w => w.tracked_show_id))]
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

      watched.forEach(w => {
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

      const byYear = {}
      Object.values(monthMap).forEach(m => {
        if (!byYear[m.year]) byYear[m.year] = []
        byYear[m.year].push({ ...m, label: MONTH_NAMES[m.month] })
      })
      Object.values(byYear).forEach(arr => arr.sort((a, b) => b.month - a.month))

      const yearlyArr = Object.values(yearMap).sort((a, b) => b.year - a.year)

      setMonthsByYear(byYear)
      setYearly(yearlyArr)
      setTotalMinutes(totalMin)
      setTotalEpisodes(watched.length)
    } finally {
      setLoading(false)
    }
  }

  async function runRecalculate() {
    setRecalculating(true)
    setRecalcResult(null)
    try {
      const shows = await fetchAll(() =>
        supabase.from('tracked_shows').select('id, tmdb_id, total_episodes, status').eq('user_id', user.id)
      )
      setRecalcProgress({ done: 0, total: shows.length })

      let fixed = 0
      for (const s of shows) {
        try {
          const details = await getShowDetails(s.tmdb_id)
          const correctTotal = computeTotalEpisodes(details)
          if (correctTotal && correctTotal !== s.total_episodes) {
            const { count } = await supabase
              .from('watched_episodes')
              .select('*', { count: 'exact', head: true })
              .eq('tracked_show_id', s.id)

            const newStatus = s.status === 'dropped'
              ? 'dropped'
              : (count >= correctTotal ? 'completed' : 'watching')

            await supabase
              .from('tracked_shows')
              .update({ total_episodes: correctTotal, status: newStatus })
              .eq('id', s.id)
            fixed++
          }
        } catch {
          // se salta esta serie si falla la consulta a TMDB
        }
        setRecalcProgress(p => ({ ...p, done: p.done + 1 }))
        await new Promise(r => setTimeout(r, 60))
      }

      setRecalcResult(fixed)
      onFixed?.()
    } finally {
      setRecalculating(false)
    }
  }

  async function runAudit() {
    setAuditing(true)
    setAuditResults(null)
    try {
      const shows = await fetchAll(() =>
        supabase.from('tracked_shows').select('*').eq('user_id', user.id)
      )
      setAuditProgress({ done: 0, total: shows.length })

      const suspects = []
      for (const s of shows) {
        try {
          const details = await getShowDetails(s.tmdb_id)
          const watched = await fetchAll(() =>
            supabase
              .from('watched_episodes')
              .select('season_number, episode_number')
              .eq('tracked_show_id', s.id)
          )

          const maxEpBySeason = new Map()
          watched.forEach(w => {
            const cur = maxEpBySeason.get(w.season_number) || 0
            if (w.episode_number > cur) maxEpBySeason.set(w.season_number, w.episode_number)
          })

          let invalid = 0
          for (const [season, maxEp] of maxEpBySeason) {
            const seasonInfo = details.seasons?.find(x => x.season_number === season)
            if (!seasonInfo || maxEp > seasonInfo.episode_count) invalid++
          }

          if (invalid > 0) suspects.push({ ...s, invalid })
        } catch {
          // si TMDB falla para esta serie, se ignora en la auditoría
        }
        setAuditProgress(p => ({ ...p, done: p.done + 1 }))
        await new Promise(r => setTimeout(r, 50))
      }

      setAuditResults(suspects)
    } finally {
      setAuditing(false)
    }
  }

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

          <h3 className="section-title"><CalendarDays size={14} /> Por año</h3>
          <div className="stats-list">
            {yearly.map(y => {
              const months = monthsByYear[y.year] || []
              const maxMonthMinutes = Math.max(1, ...months.map(m => m.minutes))
              const isOpen = expandedYear === y.year
              return (
                <div key={y.year} className="stats-year-block">
                  <button
                    className="stats-year-row"
                    onClick={() => setExpandedYear(isOpen ? null : y.year)}
                  >
                    <span className="stats-row-label">{y.year}</span>
                    <span className="stats-row-value">{y.episodes} episodios · {formatDuration(y.minutes)}</span>
                    <ChevronDown size={15} className={`chevron ${isOpen ? 'open' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="stats-month-sublist">
                      {months.map(m => (
                        <div key={m.key} className="stats-row substats-row">
                          <span className="stats-row-label">{m.label}</span>
                          <div className="stats-bar-track">
                            <div className="stats-bar-fill" style={{ width: `${(m.minutes / maxMonthMinutes) * 100}%` }} />
                          </div>
                          <span className="stats-row-value">{formatDuration(m.minutes)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <button className="import-entry-btn" onClick={runRecalculate} disabled={recalculating}>
        <RefreshCw size={16} className={recalculating ? 'spinning' : ''} />
        {recalculating
          ? `Recalculando ${recalcProgress.done}/${recalcProgress.total}...`
          : 'Recalcular totales de episodios'}
      </button>
      {recalcResult !== null && !recalculating && (
        <p className="recalc-result">
          {recalcResult > 0 ? `✔ Corregidas ${recalcResult} series` : 'Todo estaba correcto, nada que corregir'}
        </p>
      )}

      <button className="import-entry-btn" onClick={runAudit} disabled={auditing}>
        <ShieldAlert size={16} />
        {auditing
          ? `Revisando ${auditProgress.done}/${auditProgress.total}...`
          : 'Buscar series mal importadas'}
      </button>

      {auditResults !== null && !auditing && (
        auditResults.length === 0 ? (
          <p className="recalc-result">✔ No se ha encontrado ninguna serie sospechosa</p>
        ) : (
          <div className="audit-list">
            <p className="import-review-summary">
              {auditResults.length} serie(s) con episodios vistos que no encajan con su estructura real — puede que se importaran mal:
            </p>
            {auditResults.map(s => (
              <button key={s.id} className="audit-item" onClick={() => onSelectShow?.(s)}>
                {s.poster_path
                  ? <img src={posterUrl(s.poster_path, 'w92')} alt={s.name} />
                  : <div className="poster-placeholder-row">—</div>}
                <div>
                  <strong>{s.name}</strong>
                  <span>{s.invalid} episodio(s) no encajan</span>
                </div>
              </button>
            ))}
          </div>
        )
      )}

      <button className="import-entry-btn" onClick={onImport}>
        <Upload size={16} /> Importar desde TV Time
      </button>

      <button className="logout-btn" onClick={signOut}>
        <LogOut size={16} /> Cerrar sesión
      </button>
    </div>
  )
}
