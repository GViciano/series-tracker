import { useState } from 'react'
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

  if (loading) return <div className="center-msg">Cargando...</div>
  if (!user) return <Auth />

  return (
    <div className="app">
      <header className="app-header">
        <h1>📺 Series Tracker</h1>
        <div className="header-right">
          <span>{user.email}</span>
          <button onClick={signOut}>Salir</button>
        </div>
      </header>

      <main>
        {selectedShow ? (
          <ShowDetail
            show={selectedShow}
            onBack={() => setSelectedShow(null)}
            onChanged={() => setRefreshKey(k => k + 1)}
          />
        ) : (
          <>
            <ShowSearch onAdded={() => setRefreshKey(k => k + 1)} />
            <ShowList refreshKey={refreshKey} onSelect={setSelectedShow} />
          </>
        )}
      </main>
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
