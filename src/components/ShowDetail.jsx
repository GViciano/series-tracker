import { useEffect, useState, useMemo } from 'react'
import { ArrowLeft, Play, XCircle, CheckCheck } from 'lucide-react'
import { getShowDetails, getAllEpisodes, stillUrl, posterUrl } from '../lib/tmdb'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function ShowDetail({ show, onBack, onChanged }) {
  const { user } = useAuth()
  const [details, setDetails] = useState(null)
  const [episodes, setEpisodes] = useState([])
  const [watchedSet, setWatchedSet] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [expandedSeason, setExpandedSeason] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadAll()
  }, [show.id])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const d = await getShowDetails(show.tmdb_id)
      setDetails(d)
      const eps = await getAllEpisodes(show.tmdb_id, d.seasons)
      setEpisodes(eps)

      const { data: watched } = await supabase
        .from('watched_episodes')
        .select('season_number, episode_number')
        .eq('tracked_show_id', show.id)
        .eq('user_id', user.id)

      const set = new Set((watched || []).map(w => `${w.season_number}-${w.episode_number}`))
      setWatchedSet(set)

      // temporada del siguiente episodio a ver expandida por defecto
      const nextEp = findNext(eps, set)
      if (nextEp) setExpandedSeason(nextEp.season_number)
      else if (d.seasons?.length) setExpandedSeason(d.seasons.find(s => s.season_number > 0)?.season_number)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function findNext(eps, set) {
    const sorted = [...eps].sort((a, b) =>
      a.season_number - b.season_number || a.episode_number - b.episode_number
    )
    return sorted.find(ep => !set.has(`${ep.season_number}-${ep.episode_number}`))
  }

  const nextEpisode = useMemo(() => findNext(episodes, watchedSet), [episodes, watchedSet])

  const seasons = useMemo(() => {
    const map = {}
    episodes.forEach(ep => {
      if (!map[ep.season_number]) map[ep.season_number] = []
      map[ep.season_number].push(ep)
    })
    return map
  }, [episodes])

  async function toggleWatched(ep) {
    const key = `${ep.season_number}-${ep.episode_number}`
    const isWatched = watchedSet.has(key)

    if (isWatched) {
      await supabase.from('watched_episodes')
        .delete()
        .eq('tracked_show_id', show.id)
        .eq('user_id', user.id)
        .eq('season_number', ep.season_number)
        .eq('episode_number', ep.episode_number)
    } else {
      await supabase.from('watched_episodes').insert({
        user_id: user.id,
        tracked_show_id: show.id,
        season_number: ep.season_number,
        episode_number: ep.episode_number,
      })
    }

    const newSet = new Set(watchedSet)
    isWatched ? newSet.delete(key) : newSet.add(key)
    setWatchedSet(newSet)

    // actualizar estado/last_watched_at de la serie
    const totalWatched = newSet.size
    let status = show.status
    if (totalWatched === 0) status = 'plan_to_watch'
    else if (details && totalWatched >= details.number_of_episodes) status = 'completed'
    else status = 'watching'

    await supabase.from('tracked_shows')
      .update({ status, last_watched_at: new Date().toISOString() })
      .eq('id', show.id)

    onChanged?.()
  }

  async function markSeasonWatched(seasonEps) {
    const toInsert = seasonEps
      .filter(ep => !watchedSet.has(`${ep.season_number}-${ep.episode_number}`))
      .map(ep => ({
        user_id: user.id,
        tracked_show_id: show.id,
        season_number: ep.season_number,
        episode_number: ep.episode_number,
      }))
    if (toInsert.length === 0) return

    await supabase.from('watched_episodes').insert(toInsert)

    const newSet = new Set(watchedSet)
    toInsert.forEach(e => newSet.add(`${e.season_number}-${e.episode_number}`))
    setWatchedSet(newSet)

    const totalWatched = newSet.size
    const status = details && totalWatched >= details.number_of_episodes ? 'completed' : 'watching'

    await supabase.from('tracked_shows')
      .update({ status, last_watched_at: new Date().toISOString() })
      .eq('id', show.id)

    onChanged?.()
  }

  async function dropShow() {
    if (!window.confirm(`¿Abandonar "${show.name}"? Se moverá a la categoría "Abandonada".`)) return
    await supabase.from('tracked_shows').update({ status: 'dropped' }).eq('id', show.id)
    onChanged?.()
    onBack()
  }

  if (loading) return <p>Cargando episodios...</p>
  if (error) return <p className="error">{error}</p>

  return (
    <div className="show-detail">
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} /> Volver</button>

      <div className="show-detail-header">
        {show.poster_path && <img src={posterUrl(show.poster_path)} alt={show.name} />}
        <div>
          <h2>{show.name}</h2>
          <p>{watchedSet.size} / {details?.number_of_episodes ?? show.total_episodes} episodios vistos</p>
        </div>
      </div>

      {show.status !== 'dropped' && (
        <div className="detail-actions">
          <button className="drop-show-btn" onClick={dropShow}>
            <XCircle size={14} /> Abandonar serie
          </button>
        </div>
      )}

      {nextEpisode ? (
        <div className="next-episode-banner">
          <span className="next-episode-eyebrow">▸ Siguiente episodio</span>
          <span className="next-episode-code">S{String(nextEpisode.season_number).padStart(2, '0')}·E{String(nextEpisode.episode_number).padStart(2, '0')}</span>
          <h3>{nextEpisode.name}</h3>
          {nextEpisode.still_path && (
            <img src={stillUrl(nextEpisode.still_path)} alt={nextEpisode.name} />
          )}
          <button onClick={() => toggleWatched(nextEpisode)}>
            <Play size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Marcar como visto
          </button>
        </div>
      ) : (
        <div className="next-episode-banner completed">
          <span className="next-episode-eyebrow">🎉 Serie completada</span>
          <h3>Has visto todos los episodios</h3>
        </div>
      )}

      {Object.entries(seasons)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([seasonNum, eps]) => {
          const watchedInSeason = eps.filter(e => watchedSet.has(`${e.season_number}-${e.episode_number}`)).length
          const seasonComplete = watchedInSeason === eps.length
          return (
          <div key={seasonNum} className="season-block">
            <div className="season-header">
              <button
                className="season-toggle"
                onClick={() => setExpandedSeason(expandedSeason === Number(seasonNum) ? null : Number(seasonNum))}
              >
                Temporada {seasonNum}
                <span>{watchedInSeason}/{eps.length}</span>
              </button>
              {!seasonComplete && (
                <button className="season-mark-btn" onClick={() => markSeasonWatched(eps)} title="Marcar toda la temporada como vista">
                  <CheckCheck size={14} />
                </button>
              )}
            </div>
            {expandedSeason === Number(seasonNum) && (
              <div className="episode-list">
                {eps.sort((a, b) => a.episode_number - b.episode_number).map(ep => {
                  const key = `${ep.season_number}-${ep.episode_number}`
                  const isWatched = watchedSet.has(key)
                  return (
                    <div key={key} className={`episode-row ${isWatched ? 'watched' : ''}`}>
                      {ep.still_path && <img src={stillUrl(ep.still_path)} alt={ep.name} />}
                      <div className="episode-info">
                        <strong>E{ep.episode_number}. {ep.name}</strong>
                        <span>{ep.air_date}</span>
                      </div>
                      <button onClick={() => toggleWatched(ep)}>
                        {isWatched ? '✓ Visto' : 'Marcar visto'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )
        })}
    </div>
  )
}
