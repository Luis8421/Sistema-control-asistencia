# MySQL → Supabase PostgreSQL import utility

This isolated utility reads the 19 inspected `control_asistencia` MySQL tables
and inserts into a separately prepared PostgreSQL schema. It does not alter
the application backend, execute DDL, modify MySQL, or read the obsolete
SQLite database.

## Current stage and safety rules

- The shared phpMyAdmin dump contains both schema and row data. It includes
  `DROP TABLE IF EXISTS` statements; **do not import or execute that dump**.
- The utility reads MySQL with `SELECT` statements and requires a read-only
  MySQL account.
- PostgreSQL tables must already exist, be column-compatible, and be empty.
  The script refuses non-empty targets rather than overwrite or merge rows.
- Default mode and `--dry-run` are read-only: they read table/column/constraint
  metadata, count source and empty destination rows, validate references and
  nullability, stream source rows to validate conversions, and print the
  foreign-key load order. They do not execute `INSERT`, `LOCK TABLE`,
  `BEGIN`, or any write transaction. The PostgreSQL session is additionally
  guarded with `default_transaction_read_only=on`. The MySQL timezone is set
  only for that connection and is not persisted. A local JSON report is written
  with counts/status only; it does not contain database credentials or row data.
- A real import requires `--apply`, `--source-quiesced`, and the exact project
  confirmation flag. These flags are safety gates, not a substitute for
  reviewing the migration plan and obtaining explicit approval.
- No production connection has been made and no migration has been run.

## Prerequisites

1. Create a consistent MySQL backup and prove it can be restored to an
   isolated MySQL instance. The inspected tables use MyISAM; a transaction-only
   backup does not guarantee a consistent snapshot while writes continue.
2. Pause MySQL writes during the final snapshot/import window, or use a
   validated restored copy for all rehearsal runs.
3. In the disposable Supabase project, run the two reviewed files in order:
   `20261009000000_create_control_asistencia.sql`, then
   `20261009000100_add_confirmed_foreign_keys.sql`. The importer intentionally
   does not create tables or constraints.
4. The target must contain the 19 matching tables and compatible columns,
   primary keys, and foreign keys. Circular relationships must use
   deferrable PostgreSQL foreign keys. Target tables must be empty, have RLS
   enabled, and have no triggers requiring separate review.
5. Use a MySQL account limited to `SELECT` on `control_asistencia`, and a
   PostgreSQL account limited to the required target schema operations.
6. Review Supabase policies, grants, storage references, and ownership for
    the target tables before loading employee or geolocation data. This utility
    does not create, change, or remove policies or permissions.

The dump uses MyISAM, which does not enforce foreign keys. The application
owner confirmed that `departamentos.supervisor_id` and
`empleados.supervisor_id` reference `empleados.id`, while
`empleado_horario.created_by`, `asistencias.aprobado_por`, and
`incidencias.revisado_por` reference `usuarios.id`. The second versioned schema
migration adds these relationships and makes the employee/department cycle
deferrable for import. The utility checks all of them against PostgreSQL
constraints and source rows.

## Install

From the repository root in PowerShell:

```powershell
Set-Location C:\wamp64\www\LCHANGO\proyecto-asistencia\migration
npm ci
```

Set variables in a private shell or a secret manager. Do not commit a `.env`,
paste credentials into chat, or put them in frontend configuration. Copy
`.env.example` to `.env` inside `migration/` and replace the placeholders
locally. The utility loads that ignored file with dotenv; never commit it or
share its contents.

In PowerShell, from the repository root:

```powershell
Copy-Item migration\.env.example migration\.env
notepad migration\.env
```

Use a MySQL account that has only `SELECT` permission on the source database.
For `DATABASE_URL`, copy the PostgreSQL connection URI from the **test**
Supabase project's **Connect** panel; it is not the project HTTPS URL or an
anon/API key. Keep the URI private. If its password contains URL-reserved
characters, use the percent-encoded password provided by the Dashboard or
encode those characters before inserting the URI.

Required variables:

```text
MYSQL_HOST
MYSQL_DATABASE
MYSQL_USER
MYSQL_PASSWORD
DATABASE_URL
```

`MYSQL_PASSWORD` must be present, but may be empty for a passwordless MySQL
account such as a local WAMP `root` user.

Optional: `MYSQL_PORT` (default `3306`), `MYSQL_TIME_ZONE` (default `+00:00`),
and `PG_SCHEMA` (default `public`).

## Dry-run rehearsal

Use the restored, isolated source and a disposable Supabase project first.
After setting the private values in `migration/.env`, run explicitly:

```powershell
npm run migrate -- --dry-run
```

The read-only run rejects missing or non-empty destination tables, checks
source and PostgreSQL metadata, verifies foreign-key references, validates
each source row's type conversions, counts rows, and prints the dependency
order. Review the JSON report (`migration-report-*.json`) for the validation
status and counts; it contains no row values, password hashes, or tokens.

Type conversion is driven by the actual PostgreSQL column type:

- MySQL numeric values are converted to PostgreSQL `BOOLEAN` only when they
  are exactly zero or one.
- JSON strings are parsed before insertion into `JSON`/`JSONB`.
- Decimal and large integer values remain strings so JavaScript floating
  point conversion cannot alter precision.
- `DATE` and `TIME` values are passed through as strings.
- MySQL `DATETIME` is timezone-free and may only target PostgreSQL
  `TIMESTAMP WITHOUT TIME ZONE`. `DATETIME` → `TIMESTAMPTZ` is refused rather
  than guessing a timezone. MySQL `TIMESTAMP` is read in the configured
  session timezone (default UTC) and must target `TIMESTAMPTZ`.
- Enum strings are preserved; destination constraints validate accepted
  values when a later approved import runs.

## Production import gate

Do not run an import against production until backup restoration, rehearsal,
schema review, row counts, privacy/access rules, application compatibility,
and a rollback/cutover plan are signed off. A future approved production run
would require:

```powershell
npm run migrate -- --apply --source-quiesced `
  --confirm-target-project=lhygcctzdxjrevsugllg
```

This project does **not** authorize executing that command. MySQL remains
unchanged; PostgreSQL import failures roll back the data transaction. For a
full cutover, keep the MySQL source preserved and read-only until the app is
verified. If PostgreSQL has received new writes, do not simply point the
application back to MySQL without reconciling those writes.

## Tests

```powershell
npm test
```

Unit tests validate conversions, foreign-key ordering, and import gates.
They do not replace rehearsal against restored databases.
