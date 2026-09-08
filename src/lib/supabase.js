import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://yiuqnjwhuhyjugwjpfwk.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdXFuandodWh5anVnd2pwZndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTYzODMsImV4cCI6MjA5MjM3MjM4M30.pxz-TTNjkfVgFGUFAH9OyS8BB9wzsU0kN_BSu8N1Pm0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
})