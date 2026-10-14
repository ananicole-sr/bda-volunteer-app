import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { checkInSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(checkInSpec, realDeps()));
