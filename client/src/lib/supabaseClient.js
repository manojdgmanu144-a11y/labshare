import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  // Surface a clear message in the browser console instead of crashing silently.
  // This only triggers when the build was run without the required VITE_* vars.
  console.error(
    '[LabShare] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set ' +
    'as build-time env vars (--build-arg) or in a .env file when running locally.'
  );
}

export const supabase = createClient(
  supabaseUrl  ?? 'https://placeholder.supabase.co',
  supabaseAnon ?? 'placeholder-anon-key'
);
