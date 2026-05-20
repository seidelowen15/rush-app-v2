import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zrcmqwysjmyyjscxkbfb.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Bwu-OrSmwOjxznczeGmn7Q_uDxj5pyJ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
