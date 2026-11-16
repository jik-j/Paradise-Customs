# Paradise Customs self-hosted

The archive includes the built frontend in **frontend/**, its React source in **app/** and **main.tsx**, and the backend in **worker.ts** and **app/api/**. The site uses relative `/api/` URLs. The backend connects to your Cloudflare D1 database through the `DB` binding in **wrangler.jsonc**.

## Host the frontend and API together

Install Node.js 22.13 or newer and sign in to your own Cloudflare account.

1. Run `npm ci`, then `npx wrangler login`.
2. To use an empty database, run `npx wrangler d1 create paradise-customs`. Put the database name and ID from the command into **wrangler.jsonc**. Run `npx wrangler d1 migrations apply DB --remote` on the empty database. If you already have a D1 database with this schema, bind its name and ID and apply only pending migrations. Check your schema before importing or applying migrations.
3. Copy **.dev.vars.example** to **.dev.vars**. Generate two separate random values, one per variable. For example, run `node -p "require('node:crypto').randomBytes(32).toString('hex')"` twice. Keep the file private. Set the same values on your Cloudflare Worker with `npx wrangler secret put EMPLOYEE_AUTH_SEED` and `npx wrangler secret put DISCORD_STORAGE_KEY`. Use the interactive prompts.
4. Run `npm run deploy` and open the Worker URL printed by Wrangler. You can attach your own domain in the Worker’s settings.

For a local test, apply the migrations with `npx wrangler d1 migrations apply DB --local`, then run `npm run dev` with **.dev.vars** present.

## Host frontend files separately

Upload the contents of **frontend/** to your host at the root of your domain. Configure the host to return **index.html** for **/employees** and **/workshop-admin**. Forward **/api/** to your deployed Worker through a same-origin reverse proxy. The proxy must pass requests, `Set-Cookie`, and the employee session cookie. For POSTs it must verify that the incoming Origin is your frontend origin before translating it to the Worker origin. Hosting providers that allow you to serve both frontend and API on the Worker domain can use the simpler deployment above.

Keep database and authentication secrets on the backend. The browser uses the API and never receives a database credential.

## Employee sign-in

On a new database the original workshop roster is seeded on the first valid login attempt. Generate a starter password privately for a roster ID with:

```sh
node --env-file=.dev.vars tools/starter-password.mjs 21058
```

Sign in at **/employees** with the ID and generated password. Boss accounts can open **Workshop settings** from the dashboard and can hire staff with temporary passwords. Generate starter passwords only for employees who are meant to receive them. Keep the authentication seed stable because it also protects employee password hashes.

## Discord and game events

Set `DISCORD_BOT_ID`, `DISCORD_CHANNEL_ID`, `DISCORD_WEBHOOK_ID` and, if necessary, `DISCORD_SHOP` in **wrangler.jsonc** before deploying. Enter the bot token under **Workshop settings → Game Webhook** when signed in as a Boss. The token is encrypted server-side using `DISCORD_STORAGE_KEY`. Start an import with **Sync Now**, or enable the Worker cron indicated in **wrangler.jsonc**. The first connection imports from a recent window. Import older records separately if needed.

For a direct in-game integration, **integrations/paradise_customs_webhook/** contains the FiveM server resource. Under **Game Webhook**, save a workshop key and download the configuration. Install the resource and call its `SendWorkshopEvent` server export from the in-game actions that persist each record.

## Existing records

This archive contains code and schema migrations. Existing workshop history, catalogue changes, password hashes, sessions, and secrets are held in the old deployment. To bring history over, import an authorized export of the records into your D1 database after applying the schema. If moving across accounts, export data from a database you control, review the SQL, then use `npx wrangler d1 execute DB --remote --file=reviewed-data.sql`. Keep sessions and Discord connection settings out of the import. An existing password hash also requires the original authentication seed. When that seed is unavailable, use fresh credentials and reconnect the Discord bot on the new deployment.
