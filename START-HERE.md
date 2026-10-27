# Start AFTERSHOCK

The application is built. Open **http://localhost:4317** while its local server is running.

This workspace has a private `.env` configured for live Zetaris and Meterless Nightshift. Keep both services running. Preserve that file; do not replace it with `.env.example`.

```bash
cd /home/kafir/aftershock
npm ci
npm start
```

If port 4317 is already serving the app, simply open the URL. Do not start another process on the same data directory.

## Try the working loop

1. Click **New mission**. The default asks for 240 kits across four shelters. For a smaller demonstration, set south and west to zero, leaving north 60 and east 50.
2. Submit and watch the actual Cartographer, Planner and Challenger trace. Live reasoning can take several minutes. Failed calls are reported; retry is available.
3. Inspect a reservation's evidence. Choose a road used by that order in the incident control, then close it.
4. Watch the dependent reservation become held and then replaced. Unaffected reservations keep their IDs. A repair with insufficient stock, fleet or time reports a shortfall.
5. **Recheck & release** changes a reservation to a departed sandbox order. Its completion control records a simulated delivery. Nothing dispatches a real vehicle.

Reservations expire after 15 minutes before departure. Already departed orders are outside automatic repair. Use the mission cancellation control to free unused reservations before starting another demo.

## Credential-free demonstration

From a fresh checkout, without `.env`, `npm start` defaults to sample mode. In this configured workspace, explicitly choose:

```bash
APP_MODE=sample npm start
```

Stop the existing app first if using the same ports. Alternatively, run an isolated sample:

```bash
APP_MODE=sample PORT=4319 SOURCE_PORT=4320 DATA_DIR=/tmp/aftershock-demo npm start
```

Sample mode executes deterministic policies over editable synthetic sources, with actual reservations and repair. It does not make model calls or impersonate live sponsor integrations.

See [README.md](README.md) for Docker, APIs, source registration, architecture and limitations. [BUILD-STATUS.md](BUILD-STATUS.md) records verification evidence. `IDEA.md` and `CURSOR-KICKOFF.md` are historical planning documents; this implementation was built in this workspace, with Cursor optional per your update.
