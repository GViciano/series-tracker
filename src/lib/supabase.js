import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Supabase (PostgREST) limita cada consulta a 1000 filas por defecto.
// Esta función pagina automáticamente hasta traer todas las filas.
// queryFactory debe ser una función que devuelva una query NUEVA cada vez
// (no se puede reutilizar el mismo builder dos veces).
export async function fetchAll(queryFactory, pageSize = 1000) {
  let allRows = []
  let from = 0
  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1)
    if (error) throw error
    allRows = allRows.concat(data || [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return allRows
}
