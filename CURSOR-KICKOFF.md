> Historical implementation brief. The application is now built; use START-HERE.md and README.md. Cursor is optional per the user's updated instructions.

Build the first working milestone of AFTERSHOCK in this Cursor workspace.

Read IDEA.md, START-HERE.md and /home/kafir/more-info.md. The primary hackathon track is Reasoning Architecture. The concept is approved; use the finite scope in IDEA.md.

Start by checking the available environment and configuration without printing secrets. Prefer a TypeScript runtime so the Meterless reference implementations can be reused with minimal translation. Use a small persistent store for application state and deterministic code for quantities, constraints and reservation integrity. Inspect the current sponsor specifications before choosing package versions or API details.

Read the official Zetaris getting-started repository, particularly its agent instructions and connection helpers: https://github.com/zetaris/getting-started. Implement authenticated query access using the documented contract for the running instance. Verify SELECT 1, then query a tiny synthetic operational dataset registered in Zetaris. The platform installation is separate from this application.

Implement Nightshift as the primary model provider using the current POWER / Add Meterless as a provider contract at https://meterless.ai/engines.html. Read the actual routing modes from model discovery. Check reachability from WSL, token authentication and a real text response. Record the underlying Nemotron model when the runtime exposes that information. Report unsupported features accurately. Use .env.example's names consistently, updating the template if necessary. Keep provider calls bounded and handle timeouts and authentication errors explicitly.

Implement at least one Meterless Engine in the working feature. Begin with World Model for shared evidence and entity state, using the current specification/reference under https://github.com/Meterless/Meterless. Run its applicable conformance or reproducible feature checks. Introduce Markovian for bounded investigation/revision as that loop becomes active. Declare reused sponsor components and their licenses; distinguish them from work written during the hackathon.

The initial fixture has one depot, one shelter, one vehicle, two possible routes and one kit type. Expose a programmatic mission entry point. A model uses tool results to propose a dispatch. Deterministic code checks stock, capacity, route availability and deadline before persisting a reservation. Return a reservation ID, evidence references and a trace ID. Another input quantity must change the computed outcome. An impossible quantity must produce a useful rejection.

Save generated structured traces showing actual queries, model requests, decisions, checks and action receipts. Redact credentials. Keep exact constraints in structured state. Implement idempotency so retrying the same action cannot duplicate its reservation. Keep all operational writes inside the synthetic dispatch sandbox.

Add clear install/run commands and a diagnostic command. Verify successful and rejected reservations, duplicate-request handling and provider error reporting. Identify every check actually run and every dependency still unavailable. If credentials are missing, continue independent implementation and local validation, then name the exact configuration needed for live verification. Label local fixtures and reduced-capability policies accurately. Never claim that a fixture-backed run proves a sponsor connection.

Complete this milestone before UI work. The following milestone adds Cartographer, Planner and Challenger interaction, then changes an underlying road record to invalidate and repair a pending commitment. Build branches from actual inputs and evidence; generate outputs and traces during execution.

Finish by reporting what works, the verification results, the exact launch command and the next unresolved integration step.
