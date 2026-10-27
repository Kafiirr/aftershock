> Historical setup record from 23 October 2026. The application is now implemented; current run instructions are in README.md and START-HERE.md. Addresses below describe the original local installation.

**Nightshift authentication, model execution and direct WSL connectivity passed.**

Verification performed after the Runtime token was saved in `.env`. The token was not printed or copied into this document.

| Check | Observed result |
| --- | --- |
| Saved Runtime token | Present; accepted by authenticated model discovery |
| Verified application API | Reachable directly from WSL at `http://10.70.26.185:8088/v1` |
| Requested route | `meterless/auto` |
| Actual response model | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Test response | Exactly `AFTERSHOCK_OK` |
| Finish reason | `stop` |
| Reported usage for direct WSL call | 13 prompt tokens, 4 completion tokens, 17 total |
| Windows listener | Nightshift's Node process listens on `127.0.0.1:8088` and `10.70.26.185:8088` |
| Direct WSL connection | Authenticated model discovery and chat completion passed |
| Application configuration | `.env` updated to the verified Hotspot address; Runtime token preserved |

The final successful call used Python's HTTP client directly inside WSL. Windows PowerShell was used only to identify the host's listener and network addresses. The token was sent only to the verified Nightshift endpoint. The sanitized result is saved in `diagnostics/nightshift-wsl-check.json`.

Initial chat probes using a 128-token output allowance returned HTTP 502. The sanitized Runtime message reported an empty model response. A subsequent probe passed with `max_tokens: 1024` and `chat_template_kwargs: {enable_thinking: false}`. Both settings changed, so the test does not isolate which change resolved the empty response or whether Nightshift forwarded the thinking setting. Use the passing configuration for the next connectivity test.

Keep Nightshift running with Hotspot mode and token authentication enabled when running AFTERSHOCK from WSL. The Windows network address can change; rediscover and recheck it if connectivity fails after changing networks or restarting.

The temporary helpers are `/tmp/aftershock-wsl-check.py` for the direct Linux test and `/tmp/aftershock-nightshift-check.py` for Windows-local diagnostics. They read credentials from the private project `.env` and emit sanitized results. The application and both sponsor adapters were subsequently implemented; see BUILD-STATUS.md.
