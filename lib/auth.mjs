// Přihlášení přes Supabase Auth (Google). Když Supabase není nastavený, aplikace běží bez přihlášení.
export const authEnabled = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

/** Veřejná konfigurace pro prohlížeč – anon klíč je u Supabase veřejný (chrání ho RLS pravidla). */
export function publicConfig(env) {
  return authEnabled(env) ? { auth: true, supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY } : { auth: false };
}

/** Ověří přístupový token u Supabase. Vrací uživatele, nebo null. */
export async function verifyUser(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 4096) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}
