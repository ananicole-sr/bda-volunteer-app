import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { createRewardSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(createRewardSpec, realDeps()));
