import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { updateVolunteerSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(updateVolunteerSpec, realDeps()));
