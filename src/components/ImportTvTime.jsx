import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Upload, Check, AlertTriangle, HelpCircle, Search } from 'lucide-react'
import { searchShows, getShowDetails, posterUrl, computeTotalEpisodes } from '../lib/tmdb'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const MAX_CANDIDATES = 6

// Normaliza para comparar títulos ignorando mayúsculas, acentos y puntuación
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// Similitud de texto (coeficiente de Dice sobre bigramas), 0 a 1.
// Sirve para detectar coincidencias "por casualidad" de la estructura de
// temporadas/episodios entre series cuyo nombre no se parece en nada.
function bigrams(str) {
  const grams = []
  for (let i = 0; i < str.length - 1; i++) grams.push(str.slice(i, i + 2))
  return grams
}
function textSimilarity(a, b) {
  const bgA = bigrams(normalize(a))
  const bgB = bigrams(normalize(b))
  if (bgA.length === 0 || bgB.length === 0) return 0
  const used = new Array(bgB.length).fill(false)
  let matches = 0
  for (const g of bgA) {
    const idx = bgB.findIndex((x, i) => x === g && !used[i])
    if (idx !== -1) { matches++; used[idx] = true }
  }
  return (2 * matches) / (bgA.length + bgB.length)
}
const MIN_SIMILARITY = 0.3

// Cuántos episodios/temporadas no encajan entre lo que viste y la estructura
// real del candidato. 0 = coincidencia perfecta.
function countMismatches(details, maxEpisodeBySeason) {
  if (!details?.seasons) return Infinity
  if (maxEpisodeBySeason.size === 0) return 0 // sin datos de temporada/episodio para comprobar
  let invalid = 0
  for (const [season, maxEp] of maxEpisodeBySeason) {
    const seasonInfo = details.seasons.find(s => s.season_number === season)
    if (!seasonInfo) { invalid++; continue }
    if (maxEp > seasonInfo.episode_count) invalid++
  }
  return invalid
}

// Busca la mejor coincidencia entre los resultados de TMDB: prioriza título
// exacto, y valida contra la estructura real (temporadas/episodios) de cada
// candidato, ampliando la búsqueda hasta encontrar una que encaje del todo.
async function findBestMatch(results, cleanTitle, yearHint, maxEpisodeBySeason) {
  const targetNorm = normalize(cleanTitle)
  const isExact = (c) => normalize(c.name) === targetNorm || normalize(c.original_name) === targetNorm

  const reordered = [...results].sort((a, b) => (isExact(b) ? 1 : 0) - (isExact(a) ? 1 : 0))

  const checked = []
  for (const candidate of reordered.slice(0, MAX_CANDIDATES)) {
    const details = await getShowDetails(candidate.id).catch(() => null)
    const mismatches = countMismatches(details, maxEpisodeBySeason)
    const similarity = Math.max(textSimilarity(cleanTitle, candidate.name), textSimilarity(cleanTitle, candidate.original_name))
    const bonus = (isExact(candidate) ? -1 : 0) + (yearHint && candidate.first_air_date?.startsWith(yearHint) ? -0.5 : 0)
    checked.push({ candidate, details, mismatches, similarity, score: mismatches + bonus })
    // solo paramos si encaja Y el nombre se parece de verdad — si no, puede
    // ser una coincidencia de estructura por casualidad, seguimos mirando
    if (mismatches <= 0 && similarity >= MIN_SIMILARITY) break
    await new Promise(r => setTimeout(r, 50))
  }

  checked.sort((a, b) => a.score - b.score)
  return checked
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

      if (results.length > 0) {
        const checked = await findBestMatch(results, cleanTitle, yearHint, maxEpisodeBySeason)
        candidates = checked.map(c => c.candidate)
        const winner = checked[0]
        chosenId = winner.candidate.id

        if (winner.mismatches <= 0 && winner.similarity >= MIN_SIMILARITY) {
          status = 'ok'
        } else {
          // la estructura encaja pero el nombre no se parece nada — puede ser
          // coincidencia por casualidad (dos series distintas con el mismo
          // número de episodios), así que se pide revisión en vez de asumirlo
          status = 'review'
        }
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
    let alreadyExisted = 0
    const mismatched = []

    for (const m of toImport) {
      try {
        const { data: existing } = await supabase
          .from('tracked_shows')
          .select('id')
          .eq('user_id', user.id)
          .eq('tmdb_id', m.chosenId)
          .maybeSingle()

        if (existing) {
          // ya la tenías en tu lista: no se toca ni se sobrescribe nada
          alreadyExisted++
          setImportProgress(p => ({ ...p, done: p.done + 1 }))
          continue
        }

        const details = await getShowDetails(m.chosenId)

        // Comprobación de seguridad: TMDB a veces fusiona/redirige IDs
        // duplicados. Si el id que devuelve TMDB ya no coincide con el que
        // elegiste en la revisión, algo cambió por debajo — no se importa
        // a ciegas, se marca para que la busques manualmente.
        if (details.id !== m.chosenId) {
          mismatched.push(m.title)
          setImportProgress(p => ({ ...p, done: p.done + 1 }))
          continue
        }

        const totalEpisodes = computeTotalEpisodes(details)

        const watchedDates = m.episodes.map(e => new Date(e.watched_at)).filter(d => !isNaN(d))
        const lastWatched = watchedDates.length
          ? new Date(Math.max(...watchedDates.map(d => d.getTime()))).toISOString()
          : new Date().toISOString()

        const { data: inserted, error: insertError } = await supabase
          .from('tracked_shows')
          .insert({
            user_id: user.id,
            tmdb_id: m.chosenId,
            name: details.name,
            poster_path: details.poster_path,
            status: 'plan_to_watch',
            total_episodes: totalEpisodes,
            last_watched_at: lastWatched,
          })
          .select('id')
          .single()
        if (insertError) throw insertError
        const trackedShowId = inserted.id

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

        const finalStatus = count === 0
          ? 'plan_to_watch'
          : (totalEpisodes && count >= totalEpisodes ? 'completed' : 'watching')

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

    setSummary({
      importedShows,
      importedEpisodes,
      alreadyExisted,
      mismatched,
      skipped: matches.length - toImport.length,
    })
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
              Buscaremos cada serie en TMDB automáticamente y, si hay ambigüedad,
              comprobaremos las temporadas y episodios reales para elegir la
              coincidencia correcta.
            </p>
          </div>

          <div className="howto-box">
            <p className="howto-title">Cómo conseguir el archivo CSV</p>
            <p className="howto-note">
              TV Time no tiene botón propio de exportar — hace falta una extensión
              gratuita del navegador que lee tu cuenta y genera el archivo.
            </p>
            <ol className="howto-steps">
              <li>
                Instala la extensión <strong>"TV Time Data Extractor"</strong> en
                Chrome:{' '}
                <a
                  href="https://chromewebstore.google.com/detail/tv-time-data-extractor/jmpoblamjmpbhnggdihhcoejomkpkgpp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="howto-link"
                >
                  abrir en la Chrome Web Store ↗
                </a>
              </li>
              <li>
                Abre <span className="howto-code">app.tvtime.com</span> en el
                navegador e inicia sesión con tu cuenta
              </li>
              <li>
                Haz clic en el icono de la extensión (arriba a la derecha del
                navegador) y pulsa <strong>"Export to CSV"</strong>
              </li>
              <li>
                Se descargará un archivo llamado algo como{' '}
                <span className="howto-code">tv-time-export.csv</span> — guárdalo
                en un sitio fácil de encontrar
              </li>
              <li>
                Vuelve aquí y pulsa el botón de abajo para seleccionar ese archivo
              </li>
            </ol>
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
            {matches.map((m, i) => {
              const chosen = m.candidates.find(c => c.id === m.chosenId)
              return (
              <div key={m.title} className={`import-row status-${m.status}`}>
                <input
                  type="checkbox"
                  checked={m.included}
                  onChange={e => updateMatch(i, { included: e.target.checked })}
                />
                {chosen?.poster_path
                  ? <img src={posterUrl(chosen.poster_path, 'w92')} alt="" />
                  : <div className="poster-placeholder-row">—</div>}
                <div className="import-row-info">
                  <strong>{m.title}</strong>
                  {chosen && (
                    <span className="matched-name">
                      → {chosen.name}{chosen.first_air_date ? ` (${chosen.first_air_date.slice(0, 4)})` : ''}
                    </span>
                  )}
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
              )
            })}
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
          {summary.alreadyExisted > 0 && <p>{summary.alreadyExisted} series ya las tenías en tu lista — no se han tocado.</p>}
          {summary.skipped > 0 && <p>({summary.skipped} series descartadas)</p>}
          {summary.mismatched?.length > 0 && (
            <div className="mismatch-warning">
              <p>⚠ {summary.mismatched.length} serie(s) se saltaron por seguridad (TMDB cambió el ID por debajo — añádelas manualmente desde "Buscar"):</p>
              <ul>{summary.mismatched.map(t => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
