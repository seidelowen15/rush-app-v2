import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rcuqwjszheqbxjjdxwey.supabase.co'
const SUPABASE_KEY = '__DEMO_ANON_KEY__'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
})