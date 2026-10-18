import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { markRedemptionDeliveredSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(markRedemptionDeliveredSpec, realDeps()));
