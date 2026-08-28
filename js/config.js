// =========================================================================
// CivicSays — config.js
// Hard-coded Supabase project credentials for this deployment.
// Loaded as a classic <script> (NOT module) BEFORE env-loader.js.
//
// SECURITY: the anon key is public-by-design — it ships to every browser
// that loads the app. Real security lives in RLS policies (see
// supabase/migrations/0002_rls.sql). Rotate this key in the Supabase
// dashboard only if the project moves to a different deployment or if
// the current one is compromised.
//
// For a different project, edit the two values below OR override them
// at runtime by setting `window.__CIVICSAYS_ENV__` in a small inline
// <script> in any HTML page (env-loader.js checks localStorage first,
// then window.__CIVICSAYS_ENV__, so the inline script wins).
// =========================================================================

window.__CIVICSAYS_ENV__ = {
  supabaseUrl: 'https://hkzaxdcoopscuvvbithx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhremF4ZGNvb3BzY3V2dmJpdGh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NDI4MDgsImV4cCI6MjEwMzQxODgwOH0.LcsOD_IrR3PWfFIquTTXewWlPgFfi_6RYaxbw6-I1DI',
};
