import { useEffect, useState, useMemo } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { posterUrl } from '../lib/tmdb'
import { useAuth } from '../context/AuthContext'

const STATUS_LABELS = {
  plan_to_watch: 'Por empezar',
  watching: 'Viendo',
  completed: 'Acabada',
  dropped: 'Abandonada',
}

export default function ShowList({ refreshKey, onSelect }) {
  const { user } = useAuth()
  const [shows, setShows] = useState([])
  const [watchedCounts, setWatchedCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('watching')
  const [sortBy, setSortBy] = useState('last_watched_at')
  const [viewMode, setViewMode] = useState('grid') // grid | list

  useEffect(() => {
    loadShows()
  }, [user, refreshKey])

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [viewMode])

  async function loadShows() {
    setLoading(true)
    const { data: showsData, error } = await supabase
      .from('tracked_shows')
      .select('*')
      .eq('user_id', user.id)

    if (!error && showsData) {
      setShows(showsData)

      const { data: watched } = await supabase
        .from('watched_episodes')
        .select('tracked_show_id')
        .eq('user_id', user.id)

      const counts = {}
      watched?.forEach(w => {
        counts[w.tracked_show_id] = (counts[w.tracked_show_id] || 0) + 1
      })
      setWatchedCounts(counts)
    }
    setLoading(false)
  }

  const filteredSorted = useMemo(() => {
    let list = [...shows]
    if (statusFilter !== 'all') {
      list = list.filter(s => s.status === statusFilter)
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'added_at') return new Date(b.added_at) - new Date(a.added_at)
      if (sortBy === 'progress') {
        const pa = a.total_episodes ? (watchedCounts[a.id] || 0) / a.total_episodes : 0
        const pb = b.total_episodes ? (watchedCounts[b.id] || 0) / b.total_episodes : 0
        return pb - pa
      }
      if (!a.last_watched_at) return 1
      if (!b.last_watched_at) return -1
      return new Date(b.last_watched_at) - new Date(a.last_watched_at)
    })
    return list
  }, [shows, statusFilter, sortBy, watchedCounts])

  if (loading) return <p className="search-empty">Cargando series...</p>

  return (
    <div className="show-list">
      <div className="list-controls">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">Todas</option>
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="last_watched_at">Últimas vistas</option>
          <option value="added_at">Recién añadidas</option>
          <option value="progress">Progreso</option>
          <option value="name">Nombre (A-Z)</option>
        </select>
        <button
          className="view-toggle-btn"
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          title={viewMode === 'grid' ? 'Ver en lista' : 'Ver en cuadrícula'}
        >
          {viewMode === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
        </button>
      </div>

      {filteredSorted.length === 0 && (
        <div className="empty-state">
          <span className="emoji">🎬</span>
          {shows.length === 0
            ? 'Aún no has añadido ninguna serie. Ve a "Buscar" para empezar.'
            : 'No hay series en esta categoría.'}
        </div>
      )}

      {viewMode === 'grid' ? (
        <div className="show-grid cols-3">
          {filteredSorted.map(show => {
            const watched = watchedCounts[show.id] || 0
            const total = show.total_episodes || 0
            const pct = total ? Math.round((watched / total) * 100) : 0
            return (
              <div key={show.id} className="show-card" onClick={() => onSelect(show)}>
                {show.poster_path
                  ? <img src={posterUrl(show.poster_path)} alt={show.name} />
                  : <div className="poster-placeholder">Sin imagen</div>}
                <div className="show-card-body">
                  <strong>{show.name}</strong>
                  <span className={`status-badge ${show.status}`}>{STATUS_LABELS[show.status]}</span>
                  <div className="progress-row">
                    <div className="progress-ring" style={{ '--pct': pct }} />
                    <span className="progress-text">{watched}/{total} · {pct}%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="show-list-rows">
          {filteredSorted.map(show => {
            const watched = watchedCounts[show.id] || 0
            const total = show.total_episodes || 0
            const pct = total ? Math.round((watched / total) * 100) : 0
            return (
              <div key={show.id} className="show-row" onClick={() => onSelect(show)}>
                {show.poster_path
                  ? <img src={posterUrl(show.poster_path, 'w92')} alt={show.name} />
                  : <div className="poster-placeholder-row">—</div>}
                <div className="show-row-info">
                  <strong>{show.name}</strong>
                  <span className={`status-badge ${show.status}`}>{STATUS_LABELS[show.status]}</span>
                </div>
                <div className="progress-row">
                  <div className="progress-ring" style={{ '--pct': pct }} />
                  <span className="progress-text">{watched}/{total}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
