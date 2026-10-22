import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { adminRedeemRewardsSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(adminRedeemRewardsSpec, realDeps()));
