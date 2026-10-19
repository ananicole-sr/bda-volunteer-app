import { supabase } from '@/lib/supabase';

export type AppRole = 'admin' | 'guard' | 'volunteer';

export async function getMyRole(): Promise<AppRole | null> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await supabase.from('profiles').select('role').eq('id', session.session.user.id).maybeSingle();
  if (error) throw new Error(`No se pudo verificar tu rol: ${error.message}`);
  return data?.role === 'admin' || data?.role === 'guard' || data?.role === 'volunteer' ? data.role : null;
}

export function routeForRole(role: AppRole) {
  return role === 'admin' ? '/admin' : role === 'guard' ? '/guard' : '/volunteer';
}
