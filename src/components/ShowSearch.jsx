import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Check } from 'lucide-react'
import { searchShows, getShowDetails, getShowCredits, posterUrl, profileUrl, computeTotalEpisodes } from '../lib/tmdb'
import { supabase, fetchAll } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function ShowSearch({ onAdded }) {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)
  const [trackedIds, setTrackedIds] = useState(new Set())

  // Vista previa (resumen + reparto) de una serie antes de añadirla
  const [preview, setPreview] = useState(null) // { show, details, cast }
  const [previewLoading, setPreviewLoading] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetchAll(() => supabase.from('tracked_shows').select('tmdb_id').eq('user_id', user.id))
      .then(rows => setTrackedIds(new Set(rows.map(r => r.tmdb_id))))
      .catch(() => {})
  }, [user.id])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      return
    }
    setBusy(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchShows(query)
        setResults(res)
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
    }, 350)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  async function openPreview(show) {
    setPreview({ show })
    setPreviewLoading(true)
    setError(null)
    try {
      const [details, cast] = await Promise.all([
        getShowDetails(show.id),
        getShowCredits(show.id),
      ])
      setPreview({ show, details, cast })
    } catch (err) {
      setError(err.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleAdd(show, details) {
    setAdding(true)
    setError(null)
    try {
      const totalEpisodes = computeTotalEpisodes(details)
      const { error } = await supabase.from('tracked_shows').insert({
        user_id: user.id,
        tmdb_id: show.id,
        name: show.name,
        poster_path: show.poster_path,
        status: 'plan_to_watch',
        total_episodes: totalEpisodes,
      })
      if (error) throw error
      setTrackedIds(prev => new Set(prev).add(show.id))
      setPreview(null)
      setResults([])
      setQuery('')
      onAdded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  // ---------- Vista previa de una serie ----------
  if (preview) {
    const { show, details, cast } = preview
    return (
      <div className="show-preview">
        <button className="back-btn-inline" onClick={() => setPreview(null)}>
          <ArrowLeft size={16} /> Volver a resultados
        </button>

        {error && <p className="error">{error}</p>}

        <div className="preview-header">
          {show.poster_path
            ? <img src={posterUrl(show.poster_path)} alt={show.name} />
            : <div className="poster-placeholder">Sin imagen</div>}
          <div>
            <h2>{show.name}</h2>
            <p>{show.first_air_date?.slice(0, 4) || '—'}{details ? ` · ${details.number_of_episodes} episodios` : ''}</p>
          </div>
        </div>

        {previewLoading ? (
          <p className="search-empty">Cargando información...</p>
        ) : (
          <>
            {details?.overview && (
              <>
                <h3 className="section-title">Resumen</h3>
                <p className="preview-overview">{details.overview}</p>
              </>
            )}

            {cast?.length > 0 && (
              <>
                <h3 className="section-title">Reparto</h3>
                <div className="cast-scroll">
                  {cast.slice(0, 12).map(actor => (
                    <div key={actor.id} className="cast-item">
                      {actor.profile_path
                        ? <img src={profileUrl(actor.profile_path)} alt={actor.name} />
                        : <div className="cast-placeholder">{actor.name?.[0]}</div>}
                      <strong>{actor.name}</strong>
                      <span>{actor.character}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <button className="add-show-btn" onClick={() => handleAdd(show, details)} disabled={adding || trackedIds.has(show.id)}>
          {trackedIds.has(show.id) ? (
            <><Check size={16} /> Serie añadida</>
          ) : (
            <><Plus size={16} /> {adding ? 'Añadiendo...' : 'Añadir serie'}</>
          )}
        </button>
      </div>
    )
  }

  // ---------- Buscador + resultados ----------
  return (
    <div className="show-search">
      <div className="search-form">
        <input
          type="text"
          placeholder="Buscar serie (ej. Breaking Bad)..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      {error && <p className="error">{error}</p>}
      {!query.trim() && (
        <div className="search-empty">Escribe el título de una serie para ver sugerencias, ordenadas por popularidad</div>
      )}
      {query.trim() && !busy && results.length === 0 && (
        <div className="search-empty">Sin resultados para "{query}"</div>
      )}
      {results.length > 0 && (
        <div className="search-results">
          {results.map(show => (
            <div key={show.id} className="search-result-item" onClick={() => openPreview(show)}>
              {show.poster_path
                ? <img src={posterUrl(show.poster_path, 'w92')} alt={show.name} />
                : <div className="poster-placeholder">Sin imagen</div>}
              <div className="search-result-info">
                <strong>{show.name}</strong>
                <span>{show.first_air_date?.slice(0, 4) || '—'}</span>
              </div>
              {trackedIds.has(show.id) && (
                <span className="added-badge"><Check size={12} /> Añadida</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
