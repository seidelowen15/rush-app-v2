import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rcuqwjszheqbxjjdxwey.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjdXF3anN6aGVxYnhqamR4d2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxMTY2NjIsImV4cCI6MjEwODY5MjY2Mn0.WTudC8j0w2SufSEkyPMroJOgKT5v8HQb9zIB_1iZBXk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
})