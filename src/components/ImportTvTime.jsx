import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, Check, AlertTriangle, HelpCircle, Search } from 'lucide-react'
import { searchShows, getShowDetails, posterUrl } from '../lib/tmdb'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const MAX_CANDIDATES = 3

// Cuántos episodios/temporadas no encajan entre lo que viste y la estructura
// real del candidato. 0 = coincidencia perfecta.
function countMismatches(details, maxEpisodeBySeason) {
  if (!details?.seasons) return Infinity
  let invalid = 0
  for (const [season, maxEp] of maxEpisodeBySeason) {
    const seasonInfo = details.seasons.find(s => s.season_number === season)
    if (!seasonInfo) { invalid++; continue }
    if (maxEp > seasonInfo.episode_count) invalid++
  }
  return invalid
}

export default function ImportTvTime({ onImported }) {
  const { user } = useAuth()
  const fileInputRef = useRef(null)

  const [step, setStep] = useState('upload') // upload | matching | review | importing | done
  const [matches, setMatches] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        const episodeRows = result.data.filter(r => r.type === 'watch' && r.media_type === 'episode')
        if (episodeRows.length === 0) {
          setError('No se han encontrado episodios vistos en este archivo. ¿Es el CSV correcto de TV Time?')
          return
        }

        const byTitle = new Map()
        episodeRows.forEach(r => {
          if (!byTitle.has(r.title)) byTitle.set(r.title, [])
          byTitle.get(r.title).push(r)
        })

        setStep('matching')
        await runMatching(byTitle)
      },
      error: (err) => setError(`No se pudo leer el archivo: ${err.message}`),
    })
  }

  async function runMatching(byTitle) {
    const titles = [...byTitle.entries()]
    setProgress({ done: 0, total: titles.length })
    const built = []

    for (const [title, eps] of titles) {
      const maxEpisodeBySeason = new Map()
      eps.forEach(e => {
        const s = Number(e.season)
        const ep = Number(e.episode)
        if (!s || !ep) return
        if (!maxEpisodeBySeason.has(s) || ep > maxEpisodeBySeason.get(s)) maxEpisodeBySeason.set(s, ep)
      })

      const yearMatch = title.match(/\((\d{4})\)\s*$/)
      const yearHint = yearMatch?.[1]
      const cleanTitle = yearMatch ? title.replace(/\s*\(\d{4}\)\s*$/, '') : title

      let results = []
      try {
        results = await searchShows(cleanTitle)
      } catch {
        // se deja como "sin resultados" si falla la búsqueda
      }

      let status = 'none'
      let candidates = []
      let chosenId = null

      if (results.length === 1) {
        status = 'ok'
        candidates = [results[0]]
        chosenId = results[0].id
      } else if (results.length > 1) {
        const top = results.slice(0, MAX_CANDIDATES)
        const scored = []
        for (const c of top) {
          const details = await getShowDetails(c.id).catch(() => null)
          const mismatches = countMismatches(details, maxEpisodeBySeason)
          const yearBonus = yearHint && c.first_air_date?.startsWith(yearHint) ? -0.5 : 0
          scored.push({ candidate: c, mismatches: mismatches + yearBonus })
        }
        scored.sort((a, b) => a.mismatches - b.mismatches || (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0))
        candidates = scored.map(s => s.candidate)
        chosenId = scored[0].candidate.id
        status = scored[0].mismatches <= 0 ? 'ok' : 'review'
      }

      built.push({
        title,
        episodes: eps,
        episodesCount: eps.length,
        status,
        candidates,
        chosenId,
        included: status !== 'none',
        manualQuery: '',
      })

      setProgress(p => ({ ...p, done: p.done + 1 }))
      await new Promise(r => setTimeout(r, 60))
    }

    setMatches(built)
    setStep('review')
  }

  function updateMatch(index, patch) {
    setMatches(prev => prev.map((m, i) => i === index ? { ...m, ...patch } : m))
  }

  async function manualSearch(index) {
    const m = matches[index]
    if (!m.manualQuery.trim()) return
    try {
      const results = await searchShows(m.manualQuery)
      updateMatch(index, {
        candidates: results.slice(0, 8),
        chosenId: results[0]?.id ?? null,
        status: results.length ? 'ok' : 'none',
        included: results.length > 0,
      })
    } catch (err) {
      setError(err.message)
    }
  }

  async function runImport() {
    setStep('importing')
    const toImport = matches.filter(m => m.included && m.chosenId)
    setImportProgress({ done: 0, total: toImport.length })

    let importedShows = 0
    let importedEpisodes = 0

    for (const m of toImport) {
      try {
        const details = await getShowDetails(m.chosenId)

        const watchedDates = m.episodes.map(e => new Date(e.watched_at)).filter(d => !isNaN(d))
        const lastWatched = watchedDates.length
          ? new Date(Math.max(...watchedDates.map(d => d.getTime()))).toISOString()
          : new Date().toISOString()

        const { data: existing } = await supabase
          .from('tracked_shows')
          .select('id')
          .eq('user_id', user.id)
          .eq('tmdb_id', m.chosenId)
          .maybeSingle()

        let trackedShowId = existing?.id

        if (!trackedShowId) {
          const { data: inserted, error: insertError } = await supabase
            .from('tracked_shows')
            .insert({
              user_id: user.id,
              tmdb_id: m.chosenId,
              name: details.name,
              poster_path: details.poster_path,
              status: 'watching',
              total_episodes: details.number_of_episodes ?? 0,
              last_watched_at: lastWatched,
            })
            .select('id')
            .single()
          if (insertError) throw insertError
          trackedShowId = inserted.id
        }

        const episodeRows = m.episodes
          .map(e => ({
            user_id: user.id,
            tracked_show_id: trackedShowId,
            season_number: Number(e.season),
            episode_number: Number(e.episode),
            watched_at: e.watched_at,
          }))
          .filter(e => e.season_number > 0 && e.episode_number > 0)

        const { error: epError } = await supabase
          .from('watched_episodes')
          .upsert(episodeRows, { onConflict: 'tracked_show_id,season_number,episode_number' })
        if (epError) throw epError

        const { count } = await supabase
          .from('watched_episodes')
          .select('*', { count: 'exact', head: true })
          .eq('tracked_show_id', trackedShowId)

        const finalStatus = details.number_of_episodes && count >= details.number_of_episodes
          ? 'completed'
          : 'watching'

        await supabase
          .from('tracked_shows')
          .update({ status: finalStatus, last_watched_at: lastWatched })
          .eq('id', trackedShowId)

        importedShows++
        importedEpisodes += episodeRows.length
      } catch {
        // se cuenta como no importada y se sigue con la siguiente
      }
      setImportProgress(p => ({ ...p, done: p.done + 1 }))
    }

    setSummary({ importedShows, importedEpisodes, skipped: matches.length - toImport.length })
    setStep('done')
    onImported?.()
  }

  const includedCount = matches.filter(m => m.included && m.chosenId).length

  return (
    <div className="import-view">
      {error && <p className="error">{error}</p>}

      {step === 'upload' && (
        <>
          <div className="import-intro">
            <span className="emoji">📥</span>
            <h3>Importar desde TV Time</h3>
            <p>
              Sube el CSV que exportaste de TV Time. Buscaremos cada serie en TMDB
              automáticamente y, si hay ambigüedad, comprobaremos las temporadas y
              episodios reales para elegir la coincidencia correcta.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
          <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} /> Elegir archivo CSV
          </button>
        </>
      )}

      {step === 'matching' && (
        <div className="import-progress">
          <p className="section-title">Buscando series en TMDB...</p>
          <div className="stats-bar-track">
            <div className="stats-bar-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="progress-text">{progress.done} / {progress.total}</p>
        </div>
      )}

      {step === 'review' && (
        <>
          <p className="import-review-summary">
            {includedCount} de {matches.length} series se importarán. Revisa las que tengan aviso.
          </p>
          <div className="import-rows">
            {matches.map((m, i) => (
              <div key={m.title} className={`import-row status-${m.status}`}>
                <input
                  type="checkbox"
                  checked={m.included}
                  onChange={e => updateMatch(i, { included: e.target.checked })}
                />
                {m.candidates.find(c => c.id === m.chosenId)?.poster_path
                  ? <img src={posterUrl(m.candidates.find(c => c.id === m.chosenId).poster_path, 'w92')} alt="" />
                  : <div className="poster-placeholder-row">—</div>}
                <div className="import-row-info">
                  <strong>{m.title}</strong>
                  <span>{m.episodesCount} episodios vistos</span>

                  {m.candidates.length > 1 && (
                    <select
                      value={m.chosenId ?? ''}
                      onChange={e => updateMatch(i, { chosenId: Number(e.target.value) })}
                    >
                      {m.candidates.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.first_air_date?.slice(0, 4) || '?'})
                        </option>
                      ))}
                    </select>
                  )}

                  {m.status === 'none' && (
                    <div className="manual-search-row">
                      <input
                        type="text"
                        placeholder="Buscar título manualmente..."
                        value={m.manualQuery}
                        onChange={e => updateMatch(i, { manualQuery: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && manualSearch(i)}
                      />
                      <button onClick={() => manualSearch(i)}><Search size={14} /></button>
                    </div>
                  )}
                </div>
                <span className="import-status-icon" title={
                  m.status === 'ok' ? 'Coincidencia confirmada'
                    : m.status === 'review' ? 'Revisa: la estructura no encaja del todo'
                    : 'Sin coincidencia — busca manualmente'
                }>
                  {m.status === 'ok' && <Check size={16} />}
                  {m.status === 'review' && <AlertTriangle size={16} />}
                  {m.status === 'none' && <HelpCircle size={16} />}
                </span>
              </div>
            ))}
          </div>
          <button className="import-confirm-btn" onClick={runImport} disabled={includedCount === 0}>
            Importar {includedCount} series
          </button>
        </>
      )}

      {step === 'importing' && (
        <div className="import-progress">
          <p className="section-title">Importando a tu cuenta...</p>
          <div className="stats-bar-track">
            <div className="stats-bar-fill" style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} />
          </div>
          <p className="progress-text">{importProgress.done} / {importProgress.total}</p>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="empty-state">
          <span className="emoji">🎉</span>
          <p>Se han importado <strong>{summary.importedShows}</strong> series y <strong>{summary.importedEpisodes}</strong> episodios vistos.</p>
          {summary.skipped > 0 && <p>({summary.skipped} series descartadas)</p>}
        </div>
      )}
    </div>
  )
}
