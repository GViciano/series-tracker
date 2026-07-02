import { useState } from 'react'
import { LayoutGrid, Search, LogOut, Clapperboard } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Auth from './components/Auth'
import ShowSearch from './components/ShowSearch'
import ShowList from './components/ShowList'
import ShowDetail from './components/ShowDetail'
import './App.css'

function AppInner() {
  const { user, loading, signOut } = useAuth()
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedShow, setSelectedShow] = useState(null)
  const [tab, setTab] = useState('mine') // mine | search

  if (loading) return <div className="center-msg">Cargando...</div>
  if (!user) return <Auth />

  function goToTab(t) {
    setSelectedShow(null)
    setTab(t)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1><span className="brand-dot" /> Series Tracker</h1>
        <div className="header-right">
          <span className="user-email">{user.email}</span>
          <button className="icon-btn" onClick={signOut} title="Salir">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main>
        {selectedShow ? (
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

      {!selectedShow && (
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
