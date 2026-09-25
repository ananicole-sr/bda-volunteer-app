// Forma que ya consume el frontend (AdminTable, VolunteerRow). Se mantiene
// igual a como estaba hardcoded en admin/index.tsx para no tener que tocar
// los componentes de UI — solo cambia de dónde viene el dato.
export interface Volunteer {
  id: string;
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  avatar?: string;
}

// Forma cruda de la fila en la tabla `volunteers` de Supabase (DS1 del DFD).
export interface VolunteerRow {
  id: string;
  nfc_uid: string | null;
  full_name: string;
  community: string;
  avatar_url: string | null;
  points: number;
  last_check_in_at: string | null;
  is_active: boolean;
}
