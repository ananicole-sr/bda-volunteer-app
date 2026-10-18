import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { redeemRewardsSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(redeemRewardsSpec, realDeps()));
