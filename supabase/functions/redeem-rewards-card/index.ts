import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { redeemRewardsCardSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(redeemRewardsCardSpec, realDeps()));
