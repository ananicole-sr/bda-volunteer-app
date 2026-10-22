import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { lookupCardSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(lookupCardSpec, realDeps()));
