import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { setTitleLanguagePref } from '../lib/tmdb'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setTitleLanguagePref(session?.user?.user_metadata?.title_language || 'en')
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setTitleLanguagePref(session?.user?.user_metadata?.title_language || 'en')
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = (email, password) => supabase.auth.signUp({ email, password })
  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password })
  const signOut = () => supabase.auth.signOut()

  // Guarda la preferencia del idioma del título en el propio perfil del usuario
  async function setTitleLanguage(pref) {
    const { data, error } = await supabase.auth.updateUser({ data: { title_language: pref } })
    if (!error) {
      setUser(data.user)
      setTitleLanguagePref(pref)
    }
    return { error }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signOut, setTitleLanguage }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
