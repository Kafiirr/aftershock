# Hosting AFTERSHOCK

The GitHub repository contains the application, not your running services or credentials. A cloud server cannot reach this workspace's `localhost` or private Windows Hotspot address. Moving the app alone does not move Zetaris or Nightshift.

## Deadline-friendly option: hosted sample, recorded live run

Run the whole application as a single Docker web service with a persistent disk. Sample mode needs neither Zetaris nor Nightshift. The UI labels it as deterministic sample mode. Use the recorded live demonstration and saved traces as separate evidence of real sponsor integration.

For a Render Docker Web Service:

1. Connect this repository and select the Docker runtime.
2. Use one instance and attach a persistent disk at `/var/data`. Persistent disks require a paid service; check the current price before creating it.
3. Set the environment below. Render supplies `PORT`; retain its supplied value.
4. Set the health-check path to `/api/health`.
5. Once the assigned public hostname is known, set `APP_ORIGIN` to that exact HTTPS origin, without a trailing slash, and redeploy.
6. Create a mission through the public browser UI, close a supporting road, and verify the replacement order. Restart once and confirm state survives.

```dotenv
APP_MODE=sample
APP_HOST=0.0.0.0
DATA_DIR=/var/data
SOURCE_PORT=4318
APP_ORIGIN=https://YOUR-SERVICE.onrender.com
```

The source listener is not needed externally in sample mode. Do not add sponsor keys to a sample-only deployment. This is one shared demonstration sandbox: all visitors affect the same state. Use hosting-level access control for a private reviewer demo. The app currently has no user login, tenant isolation, rate limits or public-demo reset policy; unrestricted public production use requires those features.

Official references: [Render web services](https://render.com/docs/web-services), [persistent disks and their limitations](https://render.com/docs/disks).

## Why a standard Vercel deployment is not a drop-in fit

This application writes SQLite databases, JSON source files, World Model events and chain logs locally. It also continues investigations after the initial HTTP response and runs a watcher every five seconds. Its current design expects one long-running Node process and durable local storage.

Vercel documents that Functions do not provide the permanent shared local storage required by SQLite. Hosting only `public/` on Vercel would still require a separately hosted backend; the current browser uses same-origin `/api` requests. An API proxy, a persistent backend and origin configuration would be needed. Deploying the frontend alone does not make the agent work.

Reference: [Vercel's SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel). This describes the current app's fit with ordinary Functions hosting, not every possible Vercel service or future architecture.

## Fully hosted live mode

To run independently of your laptop, all of these must be available remotely:

| Component | Requirement |
| --- | --- |
| AFTERSHOCK | One persistent Node/Docker instance, HTTPS, durable `DATA_DIR` |
| Zetaris | A server-side installation or supported hosted instance with authenticated SQL access |
| Source service | Reachable from that Zetaris instance on the configured source URL; register all five tables there |
| Model runtime | A supported remotely reachable Meterless runtime with authentication, or a separately implemented provider adapter |
| Access controls | Authentication and resource limits before exposing live mutation/model-spend endpoints to the public |

A VM running the application and the Zetaris Compose stack is a straightforward layout. Allocate resources according to Zetaris's requirements plus the app's overhead. Keep database and source ports private. Point the app at service-network addresses, store tokens as server secrets and back up persistent volumes.

Nightshift's desktop UI does not have to exist on that server, but its current model gateway must be replaced by a supported hosted runtime if the laptop is to be switched off. Another development path is calling a cloud model provider directly while retaining the already-vendored Meterless World Model and Markovian engines in the app. That requires configuring and testing the provider path; a new cloud service has not been implemented or deployed by this repository push.

Keeping Nightshift on your laptop through a secured tunnel is a temporary demonstration option, not an independent cloud deployment: the laptop and runtime must remain on. Do not publicly expose the unauthenticated app or source services without access controls, and do not expose raw provider secrets to the browser.

The current submission is a working single-district sandbox, not a production multi-user dispatch service. A cloud migration should be tested separately from the already-working local demo.
