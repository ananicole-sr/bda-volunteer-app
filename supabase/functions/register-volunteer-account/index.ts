import { realRegistrationDeps } from "../_shared/deps.ts";
import { createRegistrationHandler } from "../_shared/registration.ts";

Deno.serve(createRegistrationHandler(realRegistrationDeps()));
