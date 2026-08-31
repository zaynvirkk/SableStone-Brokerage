"use client";
import { useEffect, useState } from "react";
type RuntimeState = {
  state:
    | "LOADING"
    | "CONNECTED"
    | "BLOCKED_OPERATOR"
    | "PERMISSION_DENIED"
    | "UNAVAILABLE";
  reason?: string;
  releaseDigest?: string;
  activation?: { state?: string; capabilities?: string[] };
};
export function RuntimeReadiness() {
  const [state, setState] = useState<RuntimeState>({ state: "LOADING" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/readiness", { cache: "no-store", signal: controller.signal })
      .then(async (response) => setState(await response.json()))
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({
            state: "UNAVAILABLE",
            reason:
              "Readiness request failed. Live capabilities remain disabled.",
          });
      });
    return () => controller.abort();
  }, []);
  const connected = state.state === "CONNECTED",
    capabilities = state.activation?.capabilities ?? [];
  return (
    <section
      className="runtime-receipt"
      aria-live="polite"
      aria-busy={state.state === "LOADING"}
    >
      <div>
        <h2>Production runtime receipt</h2>
        <p>
          {state.state === "LOADING"
            ? "Checking the authenticated production boundary…"
            : connected
              ? "The backend returned a signed activation scope."
              : state.reason}
        </p>
      </div>
      <dl>
        <div>
          <dt>Connection</dt>
          <dd>
            <span
              className={`status ${connected ? "pass" : state.state === "LOADING" ? "unknown" : "blocked"}`}
            >
              {state.state}
            </span>
          </dd>
        </div>
        <div>
          <dt>Release</dt>
          <dd>{state.releaseDigest?.slice(0, 12) ?? "Not received"}</dd>
        </div>
        <div>
          <dt>Capabilities</dt>
          <dd>
            {capabilities.length ? capabilities.join(", ") : "None enabled"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
