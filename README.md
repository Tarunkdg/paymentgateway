# Payflow Payment Gateway Demo

A complete local payment-lifecycle demonstration built with React, Vite, Node.js, Express, and SQLite. It supports both a local outcome simulator and an optional Stripe-hosted Checkout integration restricted to Stripe test mode.

> **Test mode only:** Stripe Checkout uses Stripe's hosted test checkout and test credentials; it does not make live charges. Never enter real card information. The local simulator also does not transfer money. This app never receives or stores card numbers or CVVs.

## Requirements

- Node.js 20+ and npm
- Windows, macOS, or Linux; no Docker or external database required

## Install and run

From the project root:

```powershell
npm install
npm install --prefix server
npm install --prefix client
Copy-Item server\.env.example server\.env
```

Edit `server\.env` before starting. In particular, set `JWT_SECRET` to a long, random value and change the local demo administrator password. The sample credentials shown below are for a local demo only.

Start each part in a separate PowerShell window:

```powershell
# Terminal 1 — API and SQLite database
npm run dev --prefix server

# Terminal 2 — React/Vite frontend
npm run dev --prefix client
```

Open <http://localhost:5173>. The API listens on <http://localhost:4000>; health check: <http://localhost:4000/api/health>.

Alternatively, run `npm run dev` from the project root to start both processes together (after installing the root dependencies).

## Configuration

`server\.env` (see [`server/.env.example`](server/.env.example)):

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | The simulated-result and reset endpoints work only when this is exactly `development`. |
| `PORT` | `4000` | Express API port. |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed browser origin for CORS. |
| `JWT_SECRET` | Local-only fallback | Secret used to sign admin access tokens. Set a strong secret; required in production. |
| `ADMIN_EMAIL` | `admin@example.com` | Seed administrator email. |
| `ADMIN_PASSWORD` | `DemoAdmin123!` | Seed administrator password; the database stores only its bcrypt hash. Set your own before first run. |
| `DATABASE_PATH` | `server/data/payments.sqlite` | SQLite file path. Relative paths are resolved from the server process working directory. |
| `STRIPE_SECRET_KEY` | *(unset)* | Optional Stripe **test-mode** secret key. Must start with `sk_test_`; live keys are rejected. |
| `STRIPE_WEBHOOK_SECRET` | *(unset)* | Optional/required-for-webhooks signing secret (`whsec_...`) for `/api/webhooks/stripe`. |

The default local administrator is `admin@example.com` / `DemoAdmin123!`. Configure your own `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first server start. The seed user is created if its email does not already exist; changing the environment password later does not overwrite an existing user's password.

The frontend defaults to `http://localhost:4000/api`. To change it, create `client/.env` and set `VITE_API_BASE_URL`, for example `VITE_API_BASE_URL=http://localhost:4000/api`.

### Enable Stripe test checkout

1. Create or sign in to a Stripe account and enable **Test mode** in the Stripe Dashboard.
2. Copy the **test secret key** (`sk_test_...`) to `STRIPE_SECRET_KEY` in `server/.env`. Never put secret keys in client environment variables or source control.
3. Restart the backend. **Stripe test checkout** becomes selectable on the checkout page. Stripe collects card details on its own hosted page; this app only handles the Checkout Session ID and verified status.
4. For local webhooks, install/run [Stripe CLI](https://docs.stripe.com/stripe-cli), then use:

   ```powershell
   stripe listen --forward-to localhost:4000/api/webhooks/stripe
   ```

   Copy the CLI's `whsec_...` signing secret to `STRIPE_WEBHOOK_SECRET`, restart the API, and keep the listener running. Configure the `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired` events when setting up a Dashboard webhook endpoint.

5. Use Stripe's published [test card numbers](https://docs.stripe.com/testing#cards) on the hosted test page only. For example, Stripe's standard successful test card is `4242 4242 4242 4242`; use a future expiry and any CVC. Test numbers are not real cards. This demo currently enables card payments through Stripe Checkout.

The frontend checks `/api/config` to show whether a test key is configured. The backend independently enforces `sk_test_` keys, calculates the Checkout amount from the saved order, validates the session amount/currency, and verifies Stripe webhook signatures using the raw request body. Browser redirects alone never mark an order paid. Stripe webhook events are deduplicated by event ID. Stripe's test environment may make requests to Stripe; use the local simulator for fully offline demonstrations.

## Database and reset

The server creates the SQLite database and schema automatically on startup. It uses SQLite compiled to WebAssembly, so Windows does not require Visual Studio C++ build tools. Foreign keys, status and amount constraints, unique payment/idempotency identifiers, and indexes are enabled. Amounts are stored in integer paise (for example, `129900` means ₹1,299.00). The database file is under `server/data/` by default and is git-ignored.

To clear only local demo orders and payments while running in development:

```powershell
Invoke-RestMethod -Method Post http://localhost:4000/api/dev/reset
```

This endpoint returns 404 unless `NODE_ENV=development`. It leaves the seeded administrator intact. Alternatively, stop the server and remove the specific `server\data\payments.sqlite` file to recreate a fresh database on next start (also remove its `-wal`/`-shm` sidecars if present).

## Use the demo

1. Choose **Start a demo payment** and enter customer contact details and a demo product.
2. Choose **Local simulator** to test success, failure, cancellation, and pending outcomes, or **Stripe test checkout** to continue to Stripe's hosted card page.
3. For Stripe, finish or exit the hosted test checkout. The backend checks the Stripe session and processes signed webhook updates; success receipts identify the transaction as Stripe test mode.
4. Review the payment result and unique transaction/order IDs. Successful payments offer a printable/downloadable HTML receipt.
5. Visit **Transactions** to search, filter, sort, paginate through, and inspect both simulator and Stripe test transactions.
6. Sign in through **Admin** to monitor payment activity. Successful totals contain only local simulation and/or Stripe test-mode results, never live money.

The products and their prices are defined server-side in `server/src/config/products.js`. A browser-supplied amount is ignored; the API accepts only the product identifier. The simulator records a pending payment first and then sets the status through the development-only API. Stripe Checkout creates a hosted test-mode session using that same server-priced order; only verified Stripe events or a server-to-server session status check can update its status. Reusing an idempotency key with the same request returns the original payment; reusing it with different request data is rejected.

## REST API

JSON errors use `{ "error": "..." }`; validation errors also include a `details` array. Monetary API values are integer minor units (paise), with the currency code in `currency`.

### Create an order

`POST /api/orders`

```json
{
  "customerName": "Jamie Example",
  "customerEmail": "jamie@example.com",
  "customerMobile": "+91 98765 43210",
  "productId": "starter"
}
```

Returns `201` with `{ "order": { "id": "...", "order_number": "...", "amount": 129900, "currency": "INR", "status": "created" }, "product": { "name": "Demo Starter Kit" } }`.

### Initiate a payment

`POST /api/payments/initiate`

```json
{
  "orderId": "ORDER-UUID",
  "method": "credit_card",
  "provider": "stripe",
  "idempotencyKey": "unique-key-at-least-16-chars"
}
```

`provider` is optional and defaults to `simulated`. Use `provider: "stripe"` with `method: "credit_card"` for the Stripe-hosted test checkout; the response contains a `checkoutUrl` to which the browser should redirect. Stripe is unavailable unless `STRIPE_SECRET_KEY` contains a test key. Simulator methods: `upi`, `credit_card`, `debit_card`, `net_banking`, `wallet`. No card credentials are accepted by this API.

### Simulate a result (development only)

`POST /api/payments/{paymentId}/simulate`

```json
{ "outcome": "success" }
```

`outcome` is `success`, `failure`, `cancelled`, or `pending`. This endpoint returns 404 unless `NODE_ENV` is exactly `development`. Finalized states cannot be changed to a different result.

### Stripe webhooks (verified)

- `POST /api/webhooks/stripe` — Stripe server-to-server events only; requires a valid `Stripe-Signature` verified against `STRIPE_WEBHOOK_SECRET`. The handler uses Stripe's raw-body signature verification and deduplicates event IDs.
- `GET /api/config` — returns the safe frontend flag `stripeTestModeEnabled`; never exposes credentials.

### Retrieve, list, and inspect

- `GET /api/orders/{orderId}` — order by UUID or order number.
- `GET /api/payments/{paymentId}` — payment status and associated order/customer.
- `GET /api/payments?page=1&limit=20&status=success&search=Jamie&sort=amount&direction=asc` — paginated history; `status`, `search`, `sort`, and `direction` are optional. Sort fields: `created_at`, `amount`, `customer_name`, `status`; direction: `asc` or `desc`. Maximum page size is 100.
- `GET /api/transactions/{transactionId}` — complete transaction details.
- `GET /api/transactions/{transactionId}/receipt` — downloadable printable HTML receipt.

### Administrator APIs

- `POST /api/auth/login` — body `{ "email": "...", "password": "..." }`; returns a signed JWT.
- `GET /api/admin/dashboard` — requires `Authorization: Bearer <token>`; returns transaction counts and successful simulated total.

The admin login endpoint is rate-limited. Do not use demo administrator credentials on a publicly reachable deployment.

## Tests and production build

```powershell
npm test
npm run build
```

Backend integration tests use an in-memory SQLite database. The client production bundle is written to `client/dist/`.

## Troubleshooting

- **API connection error:** confirm the backend is running on port 4000 and check `VITE_API_BASE_URL` if you changed it.
- **CORS error:** set `CLIENT_ORIGIN` to the exact Vite origin and restart the server.
- **SQLite initialization error:** rerun `npm install --prefix server` and ensure `sql.js` is present in `server/node_modules`; its SQLite runtime is WebAssembly and does not need a native compiler.
- **Admin login fails:** verify the credentials in `server/.env`. The initial administrator is seeded only when the database is created; an existing user's password is not replaced on restart.
- **Scenario controls unavailable:** the simulation and reset APIs intentionally require `NODE_ENV=development`.
- **Stripe option is disabled:** set a valid `sk_test_...` value in `server/.env` and restart the backend. Live (`sk_live_...`) keys are intentionally rejected.
- **Stripe redirects but status stays pending:** keep the `stripe listen` process running with the matching `STRIPE_WEBHOOK_SECRET`. Confirm the listener forwards to `/api/webhooks/stripe`; the app can also refresh a session with Stripe when the customer returns.
- **Stripe webhook signature error:** use the `whsec_...` value printed by the currently running Stripe CLI listener (not the Stripe API secret or a different Dashboard endpoint's secret), then restart the backend.
- **Address already in use:** change `PORT` in `server/.env` and set `VITE_API_BASE_URL` in `client/.env` to match the new API port.
