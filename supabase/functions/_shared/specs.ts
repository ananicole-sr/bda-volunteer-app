import type { FunctionSpec } from "./handler.ts";
import {
  type CheckInBody,
  type DeactivateVolunteerBody,
  type EnrollBody,
  type IssueCardBody,
  parseCheckIn,
  parseDeactivateVolunteer,
  parseEnroll,
  parseIssueCard,
  parseUpdateVolunteer,
  type UpdateVolunteerBody,
} from "./validate.ts";

export const checkInSpec: FunctionSpec<CheckInBody> = {
  name: "check-in",
  roles: ["guard", "admin"],
  parse: parseCheckIn,
  toRpc: (b, hmac, operatorId) => ({
    fn: "register_check_in",
    args: {
      p_event_id: b.event_id,
      p_uid_hmac: hmac,
      p_terminal_id: b.terminal_id,
      p_operator_id: operatorId,
      p_client_ts: b.client_ts,
    },
  }),
};

export const enrollVolunteerSpec: FunctionSpec<EnrollBody> = {
  name: "enroll-volunteer",
  roles: ["admin"],
  parse: parseEnroll,
  toRpc: (b, hmac, operatorId) => ({
    fn: "enroll_volunteer",
    args: {
      p_full_name: b.full_name,
      p_community: b.community,
      p_uid_hmac: hmac,
      p_operator_id: operatorId,
    },
  }),
};

export const issueCardSpec: FunctionSpec<IssueCardBody> = {
  name: "issue-card",
  roles: ["admin"],
  parse: parseIssueCard,
  toRpc: (b, hmac, operatorId) => ({
    fn: "issue_card",
    args: { p_volunteer_id: b.volunteer_id, p_uid_hmac: hmac, p_operator_id: operatorId },
  }),
};

export const updateVolunteerSpec: FunctionSpec<UpdateVolunteerBody> = {
  name: "update-volunteer",
  roles: ["admin"],
  parse: parseUpdateVolunteer,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "update_volunteer",
    args: {
      p_volunteer_id: b.volunteer_id,
      p_full_name: b.full_name ?? null,
      p_community: b.community ?? null,
      p_operator_id: operatorId,
    },
  }),
};

export const deactivateVolunteerSpec: FunctionSpec<DeactivateVolunteerBody> = {
  name: "deactivate-volunteer",
  roles: ["admin"],
  parse: parseDeactivateVolunteer,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "deactivate_volunteer",
    args: { p_volunteer_id: b.volunteer_id, p_operator_id: operatorId },
  }),
};
