import { useState, useEffect, useRef } from 'react'
import { LayoutGrid, Search, ArrowLeft } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Auth from './components/Auth'
import ShowSearch from './components/ShowSearch'
import ShowList from './components/ShowList'
import ShowDetail from './components/ShowDetail'
import Profile from './components/Profile'
import './App.css'

function AppInner() {
  const { user, loading } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedShow, setSelectedShow] = useState(null)
  const [tab, setTab] = useState('mine') // mine | search
  const [showProfile, setShowProfile] = useState(false)
  const mainRef = useRef(null)

  // Vuelve siempre arriba al cambiar de pantalla, para que no queden vistas
  // "desplazadas" con contenido invisible tras cambiar de sección
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [selectedShow, tab, showProfile])

  if (loading) return <div className="center-msg">Cargando...</div>
  if (!user) return <Auth />

  function goToTab(t) {
    setSelectedShow(null)
    setShowProfile(false)
    setTab(t)
  }

  const overlayOpen = !!selectedShow || showProfile

  return (
    <div className="app">
      <header className="app-header">
        {overlayOpen ? (
          <button
            className="header-back-btn"
            onClick={() => { setSelectedShow(null); setShowProfile(false) }}
          >
            <ArrowLeft size={18} /> Volver
          </button>
        ) : (
          <>
            <h1><span className="brand-dot" /> Series Tracker</h1>
            <button
              className="avatar-btn"
              onClick={() => { setSelectedShow(null); setShowProfile(true) }}
              title="Tu perfil"
            >
              {user.email?.[0]?.toUpperCase()}
            </button>
          </>
        )}
      </header>

      <main ref={mainRef}>
        {showProfile ? (
          <Profile onBack={() => setShowProfile(false)} />
        ) : selectedShow ? (
          <ShowDetail
            show={selectedShow}
            onBack={() => setSelectedShow(null)}
            onChanged={() => setRefreshKey(k => k + 1)}
          />
        ) : tab === 'search' ? (
          <ShowSearch onAdded={() => { setRefreshKey(k => k + 1); goToTab('mine') }} />
        ) : (
          <ShowList refreshKey={refreshKey} onSelect={setSelectedShow} />
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
