> Historical setup record from 23 October 2026. The application is now implemented; current run instructions are in README.md and START-HERE.md. Addresses below describe the original local installation.

# Zetaris setup status

Verified on 23 October 2026. The platform is running from `/home/kafir/zetaris-platform` in Docker Desktop with Ubuntu-22.04 WSL integration.

- All nine bundled `verify.sh` checks passed.
- PostgreSQL, driver, API and UI are healthy.
- Initialization and sample-data bootstrap jobs finished with exit code 0.
- Administrator login succeeded.
- The bundled SQL probe passed through UI → API → driver → Spark.
- A separate request from WSL to the published REST API returned `1` for `SELECT 1 AS one`.
- The JDBC port is reachable; JDBC authentication has not yet been tested independently.

## Addresses

| Connection | Value |
| --- | --- |
| Web interface | http://localhost:3000 |
| REST API base | http://localhost:8888/api/v1.0 |
| Verified organisation ID | 1 |
| JDBC URL | `jdbc:zetaris:lightning@localhost:10000` |
| JDBC driver class | `com.zetaris.lightning.jdbc.LightningDriver` |
| JDBC jar | `/home/kafir/zetaris-platform/jdbc/ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar` |

The API URL and verified organisation ID are saved in the project's private `.env`. Existing Nightshift configuration was preserved. The user-created API token saved as `ZETARIS_API_KEY` was independently verified on 23 October 2026: a Bearer-authenticated request to `/query/sql/start` returned HTTP 200 and `one=1` for `SELECT 1 AS one`. The application authentication adapter was subsequently implemented. Token verification evidence: `diagnostics/zetaris-api-token-check.json`.

## Next steps

1. Open the web interface and sign in as `admin@zetaris.com` using the initial password supplied in the platform guide.
2. Change the password in the user menu. Keep the current value in private configuration for subsequent authentication. The bundle's verifier reads `ZETARIS_ADMIN_PASSWORD` from its private `.env`, so update that value after changing the account password if you want its login checks to keep passing.
3. Open `/home/kafir/aftershock` in Cursor and use `CURSOR-KICKOFF.md`. The infrastructure is ready for the first application build. For JDBC, use the supplied Zetaris jar directly; do not start a second Spark instance or substitute a Hive driver.

## Recheck and lifecycle

From a newly opened Ubuntu terminal:

```bash
cd /home/kafir/zetaris-platform
./verify.sh
```

Docker group membership was refreshed per command during this setup because the existing shell predated WSL integration. If that shell still reports Docker socket permission errors, the helper handles this:

```bash
python3 /home/kafir/zetaris-platform/manage-local.py verify
```

To stop while keeping data, run `docker compose down` from the platform folder. To start again, run `docker compose up -d`. Leave Docker Desktop running while using the platform.

## Setup changes

The UI port binds to loopback. Bundled shell scripts have permissions 755 so the non-root container user can read them; the private `.env` has permissions 600. No existing data volumes were deleted.

Sanitized evidence: `diagnostics/zetaris-wsl-check.json`.
