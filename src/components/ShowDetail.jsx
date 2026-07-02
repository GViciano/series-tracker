import { useEffect, useState, useMemo } from 'react'
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

  if (loading) return <p>Cargando episodios...</p>
  if (error) return <p className="error">{error}</p>

  return (
    <div className="show-detail">
      <button className="back-btn" onClick={onBack}>← Volver</button>

      <div className="show-detail-header">
        {show.poster_path && <img src={posterUrl(show.poster_path)} alt={show.name} />}
        <div>
          <h2>{show.name}</h2>
          <p>{watchedSet.size} / {details?.number_of_episodes ?? show.total_episodes} episodios vistos</p>
        </div>
      </div>

      {nextEpisode ? (
        <div className="next-episode-banner">
          <strong>Siguiente episodio:</strong> T{nextEpisode.season_number}E{nextEpisode.episode_number} — {nextEpisode.name}
          {nextEpisode.still_path && (
            <img src={stillUrl(nextEpisode.still_path)} alt={nextEpisode.name} />
          )}
          <button onClick={() => toggleWatched(nextEpisode)}>Marcar como visto</button>
        </div>
      ) : (
        <div className="next-episode-banner completed">🎉 ¡Serie completada!</div>
      )}

      {Object.entries(seasons)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([seasonNum, eps]) => (
          <div key={seasonNum} className="season-block">
            <button
              className="season-toggle"
              onClick={() => setExpandedSeason(expandedSeason === Number(seasonNum) ? null : Number(seasonNum))}
            >
              Temporada {seasonNum} ({eps.filter(e => watchedSet.has(`${e.season_number}-${e.episode_number}`)).length}/{eps.length})
            </button>
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
        ))}
    </div>
  )
}
