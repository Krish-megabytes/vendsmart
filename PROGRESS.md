# VendSmart Project Progress

## Completed in this MVP

- [x] Node.js + Express API and Vite + TypeScript client
- [x] MongoDB/Mongoose models for users, machines, products, inventory, reservations and alerts
- [x] JWT authentication with hashed passwords, customer-only public registration and protected operator/admin roles
- [x] Seed accounts, ten Chandigarh University machines (Blocks A–E, Central Library, Food Court, BH-1, GH-1, Sports Complex), twelve products and additive per-machine inventory seed; reseeding relocates the older demo machines in place so past orders still resolve
- [x] Machine and product CRUD, geo-nearby machines, catalog search and stock availability
- [x] Operator inventory control, low/out-of-stock/machine-status alerts and restock operations
- [x] Stock-aware reservations, demo checkout, expiring holds, OTP verification and permanent stock deduction
- [x] OTP codes are hashed for verification and encrypted at rest; pickup code is only revealed to its customer/operator
- [x] Customer storefront, account creation/sign-in, order history, pickup UI, active-order cancellation and responsive operator dashboard
- [x] Operator inventory adjustment/add/remove UI with reservation-aware quantity validation
- [x] Admin machine create/edit and operator status controls; validated machine coordinates and catalog changes
- [x] Alert resolution suppresses repeats until the underlying condition clears; catalog archiving preserves reserved stock
- [x] Local natural-language preference filter and transparent catalog recommendations (no hosted AI/API key)
- [x] Sales/revenue metrics from completed orders and a 30-day rolling-average restock forecast
- [x] Security headers, bounded JSON input, sign-in rate limit, validation/error responses, secure JWT configuration
- [x] Interactive OpenStreetMap machine finder with device-location distance sorting (permission-denied and no-geolocation fallbacks)
- [x] Customer favorites saved per account with storefront heart toggles, a Favorites filter/tab and guest sign-in prompts (API: `GET/POST /favorites`, `DELETE /favorites/:productId`)
- [x] Live walking guide add-ons: turn-by-turn steps from the routing service, arrival detection that reveals the pickup code, and a site-wide route pill visible while browsing
- [x] Machine finder shows a walking-time estimate alongside the distance to each machine
- [x] One-tap reorder from My orders: a finished pickup re-creates the same items at the same machine and shows the new pickup code; if stock or the machine has changed, the bag is pre-filled with what is still available instead of failing
- [x] Post-order live walking guide embedded in the My orders page: the active pickup gets an in-page map that follows the device position, shows distance/ETA and a walking route (with a direct-distance fallback), keeps running while the customer browses, and auto-resumes once location permission is granted
- [x] Dedicated payment page in the checkout flow: the bag leads to a card/UPI payment screen with an order summary, client-side card (Luhn, expiry, CVV) and UPI validation, and a real pending→paid transition before the pickup code is issued (`POST /reservations/:id/pay`); unpaid orders keep a 15-minute stock hold and can be completed later from My orders
- [x] Catalog cards restyled to the card language of the recommended-machine panel: product name + converted price, availability pill (Available / Low stock / Sold out) with unit count, and a full-width Add to bag button that shows how many are already in the bag
- [x] Interactive machine map and machine list: clicking any marker or location opens that machine's shelf — machine code, live status, total units, and every product with its available quantity and price — plus a one-tap "Pick up from this machine" action (`GET /products?machineId=…`)
- [x] Recommended-machine card on the storefront (pin + machine name with distance once location is shared, LIVE badge, featured product with converted price, availability pill and unit count, one-tap CTA that switches the pickup machine, and a "Connected to Machine #code" strip); `GET /machines` now returns `availableUnits` and `topProduct` per machine
- [x] Display-currency switcher in the top bar (INR, USD, EUR, GBP, AED, SGD, AUD): prices stay stored in USD and every product, cart, order, forecast and payment total is converted at indicative rates, the choice persists in the browser, and a natural-language budget typed in the chosen currency is converted to USD before the recommendation parser reads it
- [x] Customer complaints/support page with contact options, a categorized complaint form linked to an order, stored `VC-XXXXXX` references, status tracking and operator replies; operators see every complaint, get an open-count badge in navigation and can resolve with a reply from the same page
- [x] API reference and tests for recommendations, forecasting, and pickup code encryption/verification

## Verify locally

1. In `server/`, copy `.env.example` to `.env` and set `MONGODB_URI` plus a random `JWT_SECRET` of at least 32 characters.
2. Run `npm install`, `npm run seed`, then `npm run dev` in `server/`.
3. In `client/`, run `npm run dev`; set `VITE_API_URL` if the API is not at `http://localhost:5000/api`.
4. Demo accounts: `customer@vendsmart.demo`, `operator@vendsmart.demo`, `admin@vendsmart.demo` — all seed with `password123`. These are local-only credentials; never use them outside local development. See [README.md](README.md) for the complete setup.
5. Run `npm test` in `server/` and `npm run build` in `client/`.
6. See [server/API.md](server/API.md) for the endpoint list and setup guide.

## Not production-ready yet

- The payment page is a simulated provider: it validates details but performs no card authorization or capture, and refunds or payment webhooks are not wired up.
- The recommendation engine is local keyword/category/diet/price matching, not an LLM integration.
- No live machine heartbeat/telemetry feed, email/SMS notifications, or scheduled background worker is configured.
- No production hosting, deployment pipeline, TLS/custom-domain configuration, or real-device vending hardware adapter has been set up.
- Payment, complaint and role flows were exercised against a live MongoDB; a dedicated second-customer isolation pass is still worth running before sharing an environment.
- Complaint replies are stored in-app; there is no outbound email delivery, so customers must return to the support page to read a reply.
- Maps use public OpenStreetMap tiles and the FOSSGIS/OSRM routing service; production use needs a tile/routing plan (self-hosted or paid provider) because the public services have usage policies and no uptime guarantees.
- Real payment processing, hardware telemetry, notifications, scheduled cleanup, and production deployment remain out of scope until provider credentials, hardware protocols, and a target environment are supplied.
