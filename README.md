
# PharmaSpot Point of Sale
![GitHub package.json version](https://img.shields.io/github/package-json/v/drkNsubuga/PharmaSpot) [![Build](https://github.com/drkNsubuga/PharmaSpot/actions/workflows/build.yml/badge.svg)](https://github.com/drkNsubuga/PharmaSpot/actions/workflows/build.yml) [![GitHub issues](https://img.shields.io/github/issues/drkNsubuga/PharmaSpot)](https://github.com/drkNsubuga/PharmaSpot) [![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/drkNsubuga/PharmaSpot/blob/main/LICENSE)

![PharmaSpot Logo](assets/images/logo.svg)

PharmaSpot is a cross-platform Point of Sale system designed for pharmacies and built to streamline operations and enhance customer service.

## Features

✔️ **Multi-PC Support:** Allows multiple computers on a network to access a central database, ensuring data consistency across all locations.

✔️ **Receipt Printing:** Generate professional receipts for your customers, making transactions more convenient.

✔️ **Product Search:** Quickly find products by scanning barcodes, simplifying inventory management.

✔️ **Staff Accounts and Permissions:** Create user accounts with various permission levels to control access and actions within the system.

✔️ **Product and Category Management:** Easily manage your products and categorize them for efficient organization.

✔️ **User Management:** Administer and maintain user accounts for your staff members.

✔️ **Basic Stock Management:** Keep track of your inventory and update stock levels as needed.

✔️ **Open Tabs and Orders:** Manage open tabs and orders to accommodate customer preferences.

✔️ **Customer Database:** Maintain a customer database to personalize interactions and build loyalty.

✔️ **Transaction History:** Access a comprehensive record of all transactions for reference and reporting.

✔️ **Transaction Filtering:** Filter transactions by till, cashier, or status, providing valuable insights into your sales.

✔️ **Date Range Filtering:** Narrow down transactions based on specific date ranges for in-depth analysis.

✔️ **Custom Barcode Support:** Define custom barcodes for products, enhancing flexibility in inventory management.

✔️ **Product Expiry Date Tracking:** Keep an eye on product expiry dates to prevent sales of expired items.

✔️ **Profit Calculation:** Calculate profit per item and total profit, helping you make informed business decisions.

✔️ **Low Stock Alerts:** Receive alerts for low stock levels to avoid running out of popular products.

✔️ **Expiry Date Alerts:** Stay informed about product expiration dates, reducing waste and potential liabilities.

✔️ **Improved UI** Enjoy a fresh, modern look with enhanced display quality, making the user experience more appealing.


## Demo

https://github.com/user-attachments/assets/9b066b96-f06c-4b37-8211-58fd1fea5f01

| **Point of Sale** |  **Payment Point** |
|--|--|
|<img src="screenshots/pos.png" alt="PharmaSpot Demo - POS" width="80%"/>  |<img src="screenshots/payment.png" alt="PharmaSpot Demo - Payment" width="80%"/>|
| **Receipt** |  **Transactions** |
| <img src="screenshots/receipt.png" alt="PharmaSpot Demo-Receipt" width="80%"/>| <img src="screenshots/transactions.png" alt="PharmaSpot Demo - Transactions" width="80%"/>|
| **Status Alerts** | **More on the Roadmap** |
|<img src="screenshots/alerts.png" alt="PharmaSpot Demo - Status Alerts" width="80%"/>| <ul><li>Auto Updates</li><li>Back up</li><li>Restore</li><li>Export to excel</li></ul>


## Web App

The web version runs in a browser and stores application records in PostgreSQL. The first deployment starts with an empty database; it does not import data from existing desktop installations.

## Run Locally

- Install Node.js 20.17+ and PostgreSQL.
- Create a PostgreSQL database and set `DATABASE_URL` to its connection string.
- Set `SESSION_SECRET` to a random value at least 32 characters long.
- Set `OWNER_USERNAME` and `OWNER_PASSWORD`; the password must be at least 12 characters.
- Set `UPLOADS_DIR` to a writable directory, for example `public/uploads`.
- Run `npm install`, `npm run build:web`, then `npm start`.
- Open `http://localhost:3210`.

Do not commit database credentials, owner credentials, or session secrets.

## Test Deployment

The root `render.yaml` defines a Render web service, PostgreSQL database, and persistent upload disk. Push the project to GitHub, create a Render Blueprint from the repository, enter the requested owner username and password, then deploy the web service. The Blueprint leaves automatic deployment disabled so test deployments are started manually.

The test database is configured on Render's free database plan, which is temporary. The web service and persistent upload disk use a paid plan. Do not use this test deployment for real pharmacy or customer records.

## Deploy on a DigitalOcean VPS

- Point a domain's DNS A record to the VPS IPv4 address and allow inbound ports 80 and 443 in the DigitalOcean firewall.
- Install Docker Engine and the Docker Compose plugin on the VPS.
- Copy `.env.example` to `.env`, then set the domain, unique database and session secrets, and owner credentials. Keep `.env` private.
- Run `docker compose config` to validate the configuration, then `docker compose up -d --build` to build and start the app.
- Run `docker compose logs -f web` to inspect startup. Caddy obtains HTTPS certificates after the domain resolves to the VPS.

PostgreSQL and uploaded images use Docker volumes so they survive container rebuilds. Configure and test backups before storing business data.

## Version 2 Workflows

- `POST /api/imports` uploads a supplier CSV into `UPLOADS_DIR/inventory-imports` and records metadata in PostgreSQL.
- `GET /api/imports` lists import history; `GET /api/imports/:id/preview` streams and validates rows; `POST /api/imports/:id/commit` imports only after `{ "confirm": true }`.
- `GET /api/imports/:id/file` downloads the original file; `GET /api/imports/:id/errors.csv` downloads invalid-row details.
- `GET /api/dashboard/summary?period=today|yesterday|7d|30d` returns real sales, collection, credit, inventory, category, and activity metrics. Custom ranges use `period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `GET /api/:transactionId/payments` lists payment history; `POST /api/:transactionId/payments` records an idempotent partial or final credit payment.

The sample invoice parser maps `SRATE` to the existing POS sale price and preserves `FTRATE`, MRP, tax, invoice columns, and extra source fields on batch metadata. Missing categories remain null. Separate batches retain separate expiry and stock. Repeat invoice rows are skipped using supplier invoice and row signatures.

## V2 Safe VPS Rollout

V2 migrations are additive and run automatically when the web container starts. **Back up first; do not use `docker compose down -v`**, because that deletes the database and upload volumes.

1. On the Droplet, back up PostgreSQL and uploaded files:
	```bash
	mkdir -p "$HOME/pharmaspot-backups"
	docker compose exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$HOME/pharmaspot-backups/db-$(date +%Y%m%d-%H%M%S).sql"
	docker compose exec -T web tar -C /data -czf - uploads > "$HOME/pharmaspot-backups/uploads-$(date +%Y%m%d-%H%M%S).tar.gz"
	```
2. Confirm both backup files exist and are non-empty before proceeding.
3. Run the build and tests from a development checkout: `npm ci`, `npm run build:web`, and `npm test -- --runInBand`.
4. On the Droplet, pull the approved commit and rebuild only the web service:
	```bash
	git pull origin main
	docker compose build web
	docker compose up -d --no-deps web
	docker compose logs --tail=100 web
	```
5. Verify `/healthz`, existing login/POS, a held and finalized test bill, a partial and final credit payment, CSV upload/preview, original/error downloads, and that uploads still exist after a web-container recreate. Use test records, not live pharmacy data.

If the web release fails, redeploy the previous application commit/image while retaining the same PostgreSQL and upload volumes. The added tables are backward-compatible; do not drop migrations or volumes during rollback. Restore the SQL/upload backups only if data was actually changed or corrupted, and verify a restore on a separate test instance first.

## For Developers
- Clone this project.
- Open terminal and navigate into the cloned folder.
- Set the required local PostgreSQL and owner environment variables described above.
- Run `npm install` to install dependencies.
- Run `npm run build:web` to bundle the browser client.
- Run `npm start` to start the web app.
- Run ```npm run test``` to run tests
  
## Credits

Adapted from [tngoman](https://github.com/tngoman/Store-POS).

Feel free to report any issues or suggest enhancements via [GitHub Issues](https://github.com/drkNsubuga/PharmaSpot/issues). 

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change. Take a moment to review the [Contributing Guidelines](https://github.com/drkNsubuga/PharmaSpot/blob/main/CONTRIBUTING.md).

## License

PharmaSpot Point of Sale is licensed under the [MIT License](https://github.com/drkNsubuga/PharmaSpot/blob/main/LICENSE).
