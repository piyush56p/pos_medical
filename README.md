
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

- Install Node.js 20 and PostgreSQL.
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
