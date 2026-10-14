import { createHandler } from "../_shared/handler.ts";
import { realDeps } from "../_shared/deps.ts";
import { enrollVolunteerSpec } from "../_shared/specs.ts";

Deno.serve(createHandler(enrollVolunteerSpec, realDeps()));
