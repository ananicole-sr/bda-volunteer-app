import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { linkVolunteerAccountSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(linkVolunteerAccountSpec, realDeps()));
