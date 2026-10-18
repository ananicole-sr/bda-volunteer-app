import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { deactivateRewardSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(deactivateRewardSpec, realDeps()));
