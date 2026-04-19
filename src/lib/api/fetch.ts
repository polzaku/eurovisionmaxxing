import { refreshSessionExpiry } from "@/lib/session";

export interface ApiFetchDeps {
  fetchImpl: typeof fetch;
  refreshExpiry: () => void;
}

export function __makeApiFetch(deps: ApiFetchDeps) {
  return async function apiFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await deps.fetchImpl(input, init);
    if (response.ok) {
      deps.refreshExpiry();
    }
    return response;
  };
}

export const apiFetch = __makeApiFetch({
  fetchImpl: (input, init) => globalThis.fetch(input, init),
  refreshExpiry: refreshSessionExpiry,
});
