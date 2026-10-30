# VendSmart

VendSmart is a full-stack vending marketplace and operations dashboard. The customer app is a TypeScript/Vite frontend; the API is Express + MongoDB/Mongoose.

## Current project status

This repository contains a locally runnable MVP with a customer storefront, reservations and pickup codes, operator inventory controls, alerts and demand-based restock forecasts. Demo vending locations are vendors across the Chandigarh University campus (Blocks A–E, Central Library, Food Court, Boys Hostel BH-1, Girls Hostel GH-1 and the Sports Complex), so the map, distance sorting and pickup routes work block by block. Customers can find machines on an interactive OpenStreetMap finder (sorted by device distance) and, after ordering, follow a live walking guide to the pickup machine from the My orders page, where the map keeps running while they browse the site. Maps and walking routes use the public OpenStreetMap tile and routing services and need no API key; no account data is sent to them, and device location stays in the browser except while a live route is running. Signed-in customers can save favorites for later, repeat any finished pickup in one tap from My orders, and the live guide lists turn-by-turn steps, estimates walking time to each machine, and reveals the pickup code when they arrive. Every catalog card follows the same pattern as the recommended-machine panel — name and converted price, an availability pill with the exact unit count, and a full-width Add to bag button. Clicking any pin on the machine map (or any machine in the finder list) opens that machine's shelf with every product it holds and how many units are in stock, plus a one-tap action to make it the pickup machine. The storefront opens with a recommended-machine card: the nearest stocked online machine (when location is shared, with its walking distance) or the best-stocked one otherwise, a LIVE badge, the product it holds most of with its converted price and unit count, a button that switches the pickup machine, and a "Connected to Machine #" strip using the machine code. A currency switcher in the top bar converts every displayed price from the stored USD base into INR (default), USD, EUR, GBP, AED, SGD or AUD at indicative rates; the choice is remembered per browser, and budgets typed into the natural-language filter are converted back to USD before matching. Checkout now has a dedicated payment page: the bag leads to card or UPI payment (with client-side validation and a 15-minute stock hold for unpaid orders), and only a paid order receives its pickup code. A Help & support page lets customers raise a complaint with a tracked reference, and operators can review every complaint and reply from there. Payment is simulated and complaint replies stay in-app; no real card is charged and no email is sent. Hardware telemetry, external notifications and production deployment are not configured; see [PROGRESS.md](PROGRESS.md) for scope and verification status and [server/API.md](server/API.md) for the API reference.

## Requirements

- Node.js 20.19+ or 22.12+ (Vite 8 requirement)
- MongoDB 7+ reachable from the server
- npm

## Start locally

1. Configure the API:
   ```sh
   cd server
   npm install
   cp .env.example .env
   ```
   Set `MONGODB_URI` to your MongoDB connection string and replace `JWT_SECRET` with a private random secret of at least 32 characters. Keep `.env` out of version control.
2. Seed local demo records and run the API:
   ```sh
   npm run seed
   npm run dev
   ```
   The API listens at `http://localhost:5000`; health check: `http://localhost:5000/health`.
3. In another terminal, start the frontend:
   ```sh
   cd client
   npm install
   npm run dev
   ```
   Open the URL printed by Vite (normally `http://localhost:5173`). Set `VITE_API_URL` if your API base is not `http://localhost:5000/api`.

### Local demo accounts

The additive seed creates these accounts with the password `password123`:

- Customer: `customer@vendsmart.demo`
- Operator: `operator@vendsmart.demo`
- Admin: `admin@vendsmart.demo`

These credentials are for local development only. Do not reuse them in a shared or public environment.

## Checks

Run the API's focused unit tests and production client build:

```sh
cd server && npm test
cd ../client && npm run build
```

The database seed and full reservation/role flows require a reachable MongoDB instance. See [server/API.md](server/API.md) for routes, permissions and reservation behavior.

## Deploy to Vercel

The root Vercel project serves the Vite client and routes `/api/*` requests through a serverless Express function. Before deploying, create a production MongoDB database and configure these Vercel environment variables for the target environment:

- `MONGODB_URI`: production MongoDB connection string
- `JWT_SECRET`: a private random secret of at least 32 characters

Authenticate the Vercel CLI, then deploy from the repository root:

```sh
npx vercel login
npx vercel deploy --prod
```

The production frontend calls the API at `/api` on the same deployment. If the frontend is hosted on a different origin, also set `CLIENT_URL` to that exact origin. Payment remains simulated; do not collect real payment details on a public deployment.
