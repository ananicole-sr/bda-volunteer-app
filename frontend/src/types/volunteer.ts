export interface Volunteer {
  id: string;
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  avatar?: string;
  isActive: boolean;
}

export interface UpdateVolunteerInput {
  /** Omitir = no cambiar. Al menos uno de los dos es obligatorio. */
  fullName?: string;
  community?: string;
}

/** Respuesta de negocio de update-volunteer (docs/nfc-contract.md, funcion 4). */
export type UpdateVolunteerResult =
  | {
      code: 'ok';
      changed_fields: ('full_name' | 'community')[];
      volunteer: { id: string; full_name: string; community: string; is_active: boolean };
    }
  | { code: 'volunteer_not_found'; message?: string };

/** Respuesta de negocio de deactivate-volunteer (docs/nfc-contract.md, funcion 5). */
export type DeactivateVolunteerResult =
  | {
      code: 'ok';
      already_inactive: boolean;
      volunteer: { id: string; full_name: string; is_active: false };
    }
  | { code: 'volunteer_not_found'; message?: string };

export interface VolunteerRow {
  id: string;
  full_name: string;
  community: string;
  avatar_url: string | null;
  points: number;
  last_check_in_at: string | null;
  is_active: boolean;
}
