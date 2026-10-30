# VendSmart API

Base URL: `http://localhost:5000/api`. The API returns JSON in the form `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code": ..., "message": ... } }`.

Protected routes use `Authorization: Bearer <JWT>`. Public signup always creates a `CUSTOMER`; operator/admin accounts are provisioned with the seed script or by an administrator. An `OPERATOR` is a vendor account and can own multiple machines through `Machine.vendor`. `OPERATOR` and `ADMIN` can access operations routes, but an operator only sees the inventory, forecast, alerts and overview of their own machines. Destructive machine/product changes require `ADMIN`.

## Authentication

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Create a customer. Body: `{name,email,password,phone?}`. |
| POST | `/auth/login` | Public | Login. Body: `{email,password}`. |
| GET | `/auth/me` | Signed in | Get the current profile. |
| POST | `/auth/logout` | Signed in | Client-side JWT logout acknowledgement. |

## Machines and catalog

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| GET | `/machines?lat=30.7695&lng=76.575&radius=25000` | Public | List machines, optionally nearest-first within a radius in meters. |
| GET | `/machines/:id` | Public | Machine details. |
| POST | `/machines` | Admin | Create a machine. Body includes `name,code,address,latitude,longitude`; optional `description,capacity,vendorId`. |
| PATCH | `/machines/:id` | Operator | Update `name,description,address,status,capacity` or coordinates. Status is `ONLINE`, `OFFLINE`, or `MAINTENANCE`; coordinates are checked against valid latitude/longitude ranges. Only an admin can change `vendorId` (an `OPERATOR` account, or `null` to unassign). |
| DELETE | `/machines/:id` | Admin | Remove a vendor location, its inventory and its alerts. Rejected while the machine has `PENDING` or `PAID` orders; past orders stay in history. |
| GET | `/products?machineId=...&search=...&category=...` | Public | Search the active catalog and optionally include available stock for a machine. |
| GET | `/recommendations?prompt=vegan+snack+under+4&machineId=...` | Public | Rank available products using local keyword, category, diet, and price matching. No LLM/API key is sent or required. |
| POST | `/products` | Operator | Create product with `name,sku,category,price`; optional `description,image,tags`. |
| PATCH | `/products/:id` | Operator | Update product fields. Product edits are validated; archiving (`active:false`) is rejected until all on-hand inventory is removed. |
| DELETE | `/products/:id` | Admin | Soft-delete a product only after all on-hand inventory is removed, including stock currently held for reservations. |

## Favorites

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| GET | `/favorites` | Signed in | List the caller's saved products. Archived products are omitted. |
| POST | `/favorites` | Signed in | Save a favorite. Body: `{productId}`; only active products are accepted and duplicates are ignored. |
| DELETE | `/favorites/:productId` | Signed in | Remove a saved product. |

## Inventory and operations

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| GET | `/inventory?machineId=...&productId=...` | Operator | List inventory with machine/product details. An operator only receives rows for machines assigned to their vendor account; an admin sees every machine. |
| PUT | `/inventory` | Operator | Create or update a stock row: `{machineId,productId,quantity,lowStockThreshold?,slot?}`. Reserved units cannot be removed, and an operator can only stock their own machines. |
| DELETE | `/inventory/:id` | Operator | Delete an inventory row only when there are no reserved units and the machine belongs to the caller's vendor account. |
| GET | `/overview` | Operator | Live machine, sales, revenue, low-stock, alert, restock, and recent-order summary. |
| GET | `/forecast?days=30` | Operator | Rolling demand and days-of-stock projection (7–90 day period). |
| PATCH | `/alerts/:id/resolve` | Operator | Resolve and suppress an open alert until its underlying condition clears; if it recurs after clearing, a new alert is created. |

## Users (admin)

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| GET | `/users` | Admin | List customer, vendor and admin accounts with `role`, `banned` and `createdAt`. Password hashes are never returned. |
| PATCH | `/users/:id/ban` | Admin | Body: `{banned:true}` or `{banned:false}`. Banned accounts are blocked at sign-in and on every authenticated request. Administrator accounts and the caller cannot be banned. |
| DELETE | `/users/:id` | Admin | Permanently remove a customer or vendor account. Administrator accounts and the caller cannot be removed. Removing a vendor account leaves its machines on the network but unassigns them (`vendor: null`). |

## Reservations and pickup

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| POST | `/reservations` | Signed in | Reserve 1–20 lines at an online machine. Body: `{machineId,items:[{productId,quantity}],paymentMethod}`. `DEMO` pays immediately and returns a one-time 6-digit code. `CARD` or `UPI` hold stock for 15 minutes and return a `PENDING` order with no code until it is paid. |
| GET | `/reservations` | Signed in | Customers see only their own orders; operators see all. Optional `status`. |
| GET | `/reservations/:id` | Owner or operator | Get one reservation. |
| POST | `/reservations/:id/pay` | Owner | Pay a held order and unlock its pickup code. Body: `{method:"CARD",last4:"4242"}` or `{method:"UPI",upiId:"name@bank"}`. Only the last four card digits are accepted; full card numbers never reach the API. Returns the 6-digit code once and extends the hold by 15 minutes. |
| POST | `/reservations/:id/cancel` | Owner | Cancel an active order and release held stock. |
| POST | `/reservations/:id/dispense` | Owner or operator | Verify `{otp:"123456"}`, then permanently deduct reserved and on-hand stock. |

A paid order keeps its stock and pickup code for a 15-minute pickup window (`otpExpiresAt`). When the window closes without a dispense, the order becomes `EXPIRED`, its held stock is released, and a paid order records `refundedAt` plus `refundAmount` (the simulated payment is refunded in full). The client counts the window down live and refreshes the order once it reaches zero. There is no background worker yet: expiry is applied whenever an authenticated reservation, overview, or forecast request calls the expiry sweep.

## Complaints and support

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| POST | `/complaints` | Signed in | Raise a complaint. Body: `{category,subject,message,reservationId?,machineId?}`. Category is `ORDER`, `PAYMENT`, `MACHINE` or `OTHER`; subject is 4–120 characters and message 20–2000. A linked order must belong to the caller and supplies the machine. Returns a `VC-XXXXXX` reference. |
| GET | `/complaints` | Signed in | Customers see their own complaints with any operator reply; operators and admins see every complaint. Optional `status`. |
| PATCH | `/complaints/:id/resolve` | Operator | Close an open complaint, optionally storing a `{response}` of up to 1000 characters for the customer. |

The payment step is intentionally a simulated provider, not a card processor. It validates the card/UPI shape in the browser, sends only the last four digits, and records a `PAY-...` reference. Set `DEMO_MODE=false` to stop demo checkouts from being marked paid; a real payment gateway/webhook must replace `POST /reservations/:id/pay` before accepting real money. Pickup codes are hashed for verification and encrypted at rest. Keep `JWT_SECRET` private, random, and at least 32 characters long; changing it invalidates JWT sessions and makes stored pickup codes unreadable.

## Run locally

1. Copy `.env.example` to `.env` and set `MONGODB_URI` and a long random `JWT_SECRET`.
2. Run `npm install` in `server/`, then `npm run seed` to add sample records. The seed is additive and will not clear an existing database.
3. Run `npm run dev` in `server/`. Run `npm run dev` in `client/`; set `VITE_API_URL` if the API is not at `http://localhost:5000/api`.
4. The demo customer account is `customer@vendsmart.demo`, the operator is `operator@vendsmart.demo`, and the admin is `admin@vendsmart.demo`; each seeded account uses `password123`. Change these credentials for any non-local use.
5. Run server unit tests with `npm test` in `server/`; build the client with `npm run build` in `client/`.
