import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { markRedemptionItemDeliveredSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(markRedemptionItemDeliveredSpec, realDeps()));
