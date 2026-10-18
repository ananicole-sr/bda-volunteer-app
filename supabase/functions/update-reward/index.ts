import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { updateRewardSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(updateRewardSpec, realDeps()));
