import type { FunctionSpec } from "./handler.ts";
import {
  type CheckInBody,
  type CreateRewardBody,
  type DeactivateRewardBody,
  type DeactivateVolunteerBody,
  type EnrollBody,
  type IssueCardBody,
  type LinkVolunteerAccountBody,
  type MarkNotificationsReadBody,
  type MarkRedemptionDeliveredBody,
  parseCheckIn,
  parseCreateReward,
  parseDeactivateReward,
  parseDeactivateVolunteer,
  parseEnroll,
  parseIssueCard,
  parseLinkVolunteerAccount,
  parseMarkNotificationsRead,
  parseMarkRedemptionDelivered,
  parseRedeemRewards,
  parseSetVolunteerAvatar,
  parseUpdateReward,
  parseUpdateVolunteer,
  type RedeemRewardsBody,
  type SetVolunteerAvatarBody,
  type UpdateRewardBody,
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

export const setVolunteerAvatarSpec: FunctionSpec<SetVolunteerAvatarBody> = {
  name: "set-volunteer-avatar",
  roles: ["admin"],
  parse: parseSetVolunteerAvatar,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "set_volunteer_avatar",
    args: { p_volunteer_id: b.volunteer_id, p_path: b.path, p_operator_id: operatorId },
  }),
};

export const createRewardSpec: FunctionSpec<CreateRewardBody> = {
  name: "create-reward",
  roles: ["admin"],
  parse: parseCreateReward,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "create_reward",
    args: {
      p_name: b.name,
      p_description: b.description,
      p_points_cost: b.points_cost,
      p_stock: b.stock,
      p_operator_id: operatorId,
    },
  }),
};

export const updateRewardSpec: FunctionSpec<UpdateRewardBody> = {
  name: "update-reward",
  roles: ["admin"],
  parse: parseUpdateReward,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "update_reward",
    args: {
      p_reward_id: b.reward_id,
      p_name: b.name ?? null,
      p_description: b.description ?? null,
      // description: null (o vacia) en el cuerpo = borrarla; ausente = no cambiar.
      p_clear_description: "description" in b && b.description === null,
      p_points_cost: b.points_cost ?? null,
      p_stock: b.stock ?? null,
      p_operator_id: operatorId,
    },
  }),
};

export const deactivateRewardSpec: FunctionSpec<DeactivateRewardBody> = {
  name: "deactivate-reward",
  roles: ["admin"],
  parse: parseDeactivateReward,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "deactivate_reward",
    args: { p_reward_id: b.reward_id, p_operator_id: operatorId },
  }),
};

export const linkVolunteerAccountSpec: FunctionSpec<LinkVolunteerAccountBody> = {
  name: "link-volunteer-account",
  roles: ["admin"],
  parse: parseLinkVolunteerAccount,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "link_volunteer_account",
    args: { p_volunteer_id: b.volunteer_id, p_user_id: b.user_id, p_operator_id: operatorId },
  }),
};

// La identidad del voluntario sale del JWT: p_user_id = id de la sesion. El
// cuerpo nunca trae volunteer_id, saldo ni costos (si los trae, se ignoran).
export const redeemRewardsSpec: FunctionSpec<RedeemRewardsBody> = {
  name: "redeem-rewards",
  roles: ["volunteer"],
  parse: parseRedeemRewards,
  toRpc: (b, _hmac, userId) => ({
    fn: "redeem_rewards",
    args: { p_user_id: userId, p_client_request_id: b.client_request_id, p_reward_ids: b.reward_ids },
  }),
};

export const markRedemptionDeliveredSpec: FunctionSpec<MarkRedemptionDeliveredBody> = {
  name: "mark-redemption-delivered",
  roles: ["admin"],
  parse: parseMarkRedemptionDelivered,
  toRpc: (b, _hmac, operatorId) => ({
    fn: "mark_redemption_delivered",
    args: { p_request_id: b.request_id, p_operator_id: operatorId },
  }),
};

// El estado de leido es del admin de la sesion (p_admin_id sale del JWT).
export const markNotificationsReadSpec: FunctionSpec<MarkNotificationsReadBody> = {
  name: "mark-notifications-read",
  roles: ["admin"],
  parse: parseMarkNotificationsRead,
  toRpc: (b, _hmac, adminId) => ({
    fn: "mark_admin_notifications_read",
    args: { p_admin_id: adminId, p_notification_ids: b.notification_ids },
  }),
};
