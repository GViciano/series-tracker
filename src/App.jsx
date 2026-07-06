import { useState, useEffect, useRef } from 'react'
import { LayoutGrid, Search, ArrowLeft } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Auth from './components/Auth'
import ShowSearch from './components/ShowSearch'
import ShowList from './components/ShowList'
import ShowDetail from './components/ShowDetail'
import Profile from './components/Profile'
import ImportTvTime from './components/ImportTvTime'
import './App.css'

function AppInner() {
  const { user, loading } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedShow, setSelectedShow] = useState(null)
  const [tab, setTab] = useState('mine') // mine | search
  const [showProfile, setShowProfile] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const mainRef = useRef(null)

  // Vuelve siempre arriba al cambiar de pantalla, para que no queden vistas
  // "desplazadas" con contenido invisible tras cambiar de sección
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [selectedShow, tab, showProfile, showImport])

  if (loading) return <div className="center-msg">Cargando...</div>
  if (!user) return <Auth />

  function goToTab(t) {
    setSelectedShow(null)
    setShowProfile(false)
    setShowImport(false)
    setTab(t)
  }

  function closeOverlays() {
    setSelectedShow(null)
    setShowProfile(false)
    setShowImport(false)
  }

  const overlayOpen = !!selectedShow || showProfile || showImport

  return (
    <div className="app">
      <header
        className="app-header"
        style={{ cursor: overlayOpen ? 'default' : 'pointer' }}
        onClick={!overlayOpen ? () => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) : undefined}
      >
        {overlayOpen ? (
          <button className="header-back-btn" onClick={closeOverlays}>
            <ArrowLeft size={18} /> Volver
          </button>
        ) : (
          <>
            <h1><img src={`${import.meta.env.BASE_URL}tv-icon.svg`} alt="" className="brand-icon" /> Series Tracker</h1>
            <button
              className="avatar-btn"
              onClick={(e) => { e.stopPropagation(); setSelectedShow(null); setShowProfile(true) }}
              title="Tu perfil"
            >
              {user.email?.[0]?.toUpperCase()}
            </button>
          </>
        )}
      </header>

      <main ref={mainRef}>
        {showImport ? (
          <ImportTvTime onImported={() => setRefreshKey(k => k + 1)} />
        ) : showProfile ? (
          <Profile
            onImport={() => { setShowProfile(false); setShowImport(true) }}
            onFixed={() => setRefreshKey(k => k + 1)}
            onSelectShow={(s) => { setShowProfile(false); setSelectedShow(s) }}
          />
        ) : selectedShow ? (
          <ShowDetail
            show={selectedShow}
            onBack={() => setSelectedShow(null)}
            onChanged={() => setRefreshKey(k => k + 1)}
          />
        ) : tab === 'search' ? (
          <ShowSearch onAdded={() => { setRefreshKey(k => k + 1); goToTab('mine') }} />
        ) : (
          <ShowList
            refreshKey={refreshKey}
            onSelect={setSelectedShow}
            onImport={() => setShowImport(true)}
            onGoSearch={() => goToTab('search')}
          />
        )}
      </main>

      {!overlayOpen && (
        <nav className="bottom-nav">
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => goToTab('mine')}>
            <LayoutGrid size={20} />
            Mis series
          </button>
          <button className={tab === 'search' ? 'active' : ''} onClick={() => goToTab('search')}>
            <Search size={20} />
            Buscar
          </button>
        </nav>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
