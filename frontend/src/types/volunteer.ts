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

/** Respuesta de negocio de link-volunteer-account (docs/nfc-contract.md, funcion 9). */
export type LinkVolunteerAccountResult =
  | {
      code: 'ok';
      /** true = ya estaba vinculado a esa misma cuenta (no se escribio nada). */
      already_linked: boolean;
      volunteer: { id: string; full_name: string; user_id: string };
    }
  | {
      code:
        | 'volunteer_not_found'
        | 'account_not_found'
        | 'account_not_volunteer'
        | 'volunteer_already_linked'
        | 'account_in_use';
      message?: string;
    };

// ---------------------------------------------------------------- datos propios (rol volunteer)

/** Perfil del voluntario vinculado a la sesion actual. */
export interface MyVolunteerProfile extends Volunteer {
  totalVisits: number;
  /** ISO-8601, o null si nunca ha hecho check-in. */
  lastCheckInAt: string | null;
}

export interface PageOptions {
  /** 1 en adelante. Default 1. */
  page?: number;
  /** 1 a 50. Default 20. */
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface MyCheckIn {
  id: string;
  checkedInAt: string;
  pointsAwarded: number;
  visitNumber: number | null;
  status: 'valid' | 'duplicate' | 'rejected';
}

export interface MyRedemption {
  id: string;
  redeemedAt: string;
  pointsSpent: number;
  /** null solo si la recompensa dejo de ser visible para el voluntario. */
  reward: { id: string; name: string } | null;
}
