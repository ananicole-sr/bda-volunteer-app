// Respuestas HTTP del contrato (docs/nfc-contract.md, seccion "HTTP").

const HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/** 200 para todo codigo de negocio: se pasa tal cual el jsonb de la funcion SQL. */
export const ok = (body: unknown) => json(200, body);
export const unauthorized = () => json(401, { code: "unauthorized" });
export const forbidden = () => json(403, { code: "forbidden" });
export const invalidRequest = (message: string) => json(400, { code: "invalid_request", message });
/** Error inesperado: nunca se filtran detalles al cliente. */
export const serverError = () => json(500, { code: "server_error" });
