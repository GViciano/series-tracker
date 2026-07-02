import { useState, useEffect, useRef } from 'react'
import { searchShows, getShowDetails, posterUrl } from '../lib/tmdb'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function ShowSearch({ onAdded }) {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [addingId, setAddingId] = useState(null)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  // Autocompletado: busca automáticamente mientras se escribe, con debounce
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

  async function handleAdd(show) {
    setAddingId(show.id)
    setError(null)
    try {
      const details = await getShowDetails(show.id)
      const totalEpisodes = details.number_of_episodes ?? 0

      const { error } = await supabase.from('tracked_shows').insert({
        user_id: user.id,
        tmdb_id: show.id,
        name: show.name,
        poster_path: show.poster_path,
        status: 'plan_to_watch',
        total_episodes: totalEpisodes,
      })
      if (error) throw error
      setResults([])
      setQuery('')
      onAdded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingId(null)
    }
  }

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
            <div key={show.id} className="search-result-item">
              {show.poster_path
                ? <img src={posterUrl(show.poster_path, 'w92')} alt={show.name} />
                : <div className="poster-placeholder">Sin imagen</div>}
              <div className="search-result-info">
                <strong>{show.name}</strong>
                <span>{show.first_air_date?.slice(0, 4) || '—'}</span>
              </div>
              <button onClick={() => handleAdd(show)} disabled={addingId === show.id}>
                {addingId === show.id ? 'Añadiendo...' : 'Añadir'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
