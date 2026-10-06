export interface Volunteer {
  id: string;
  name: string;
  community: string;
  points: number;
  lastVisit: string;
  avatar?: string;
}

export interface VolunteerRow {
  id: string;
  full_name: string;
  community: string;
  avatar_url: string | null;
  points: number;
  last_check_in_at: string | null;
  is_active: boolean;
}
