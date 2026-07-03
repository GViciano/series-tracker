const API_KEY = import.meta.env.VITE_TMDB_API_KEY
const BASE_URL = 'https://api.themoviedb.org/3'
const IMG_BASE = 'https://image.tmdb.org/t/p'

function url(path, params = {}) {
  const u = new URL(BASE_URL + path)
  u.searchParams.set('api_key', API_KEY)
  u.searchParams.set('language', 'es-ES')
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v))
  return u.toString()
}

export function posterUrl(path, size = 'w342') {
  if (!path) return null
  return `${IMG_BASE}/${size}${path}`
}

export function stillUrl(path, size = 'w300') {
  if (!path) return null
  return `${IMG_BASE}/${size}${path}`
}

export async function searchShows(query) {
  if (!query?.trim()) return []
  const [esRes, enRes] = await Promise.all([
    fetch(url('/search/tv', { query, language: 'es-ES' })),
    fetch(url('/search/tv', { query, language: 'en-US' })),
  ])
  if (!esRes.ok && !enRes.ok) throw new Error('Error buscando series en TMDB')

  const esData = esRes.ok ? await esRes.json() : { results: [] }
  const enData = enRes.ok ? await enRes.json() : { results: [] }

  const merged = new Map()
  ;[...(esData.results ?? []), ...(enData.results ?? [])].forEach(show => {
    if (!merged.has(show.id)) merged.set(show.id, show)
  })

  return [...merged.values()].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
}

export async function getShowCredits(tmdbId) {
  const res = await fetch(url(`/tv/${tmdbId}/credits`))
  if (!res.ok) throw new Error('Error obteniendo el reparto')
  const data = await res.json()
  return data.cast ?? []
}

export function profileUrl(path, size = 'w185') {
  if (!path) return null
  return `${IMG_BASE}/${size}${path}`
}

// El campo "number_of_episodes" de TMDB a veces está desactualizado (sobre todo
// en series con temporadas recientes) y puede venir en 0. Sumar los episodios
// por temporada (excluyendo especiales) es más fiable.
export function computeTotalEpisodes(details) {
  if (!details?.seasons) return details?.number_of_episodes ?? 0
  const sum = details.seasons
    .filter(s => s.season_number > 0)
    .reduce((acc, s) => acc + (s.episode_count || 0), 0)
  return sum || details.number_of_episodes || 0
}

export async function getShowDetails(tmdbId) {
  const res = await fetch(url(`/tv/${tmdbId}`))
  if (!res.ok) throw new Error('Error obteniendo detalles de la serie')
  return res.json()
}

export async function getSeasonEpisodes(tmdbId, seasonNumber) {
  const res = await fetch(url(`/tv/${tmdbId}/season/${seasonNumber}`))
  if (!res.ok) throw new Error('Error obteniendo episodios de la temporada')
  const data = await res.json()
  return data.episodes ?? []
}

// Trae TODOS los episodios de todas las temporadas de una serie (aplana el resultado)
export async function getAllEpisodes(tmdbId, seasons) {
  // seasons: array de objetos temporada desde getShowDetails (excluye "specials" season_number 0 si se desea)
  const realSeasons = seasons.filter(s => s.season_number > 0)
  const results = await Promise.all(
    realSeasons.map(s => getSeasonEpisodes(tmdbId, s.season_number))
  )
  return results.flat()
}
