# iTech Avengers Bot Engine (v1.0.0)

> **Telegram Order Management + Loader Fulfillment + Crypto Payments + Dynamic Pricing Engine + Realized P&L Dashboard**
>
> Built with **PostgreSQL 16 (ACID & PGlite WASM)**, **TypeScript**, **Express REST API**, **React 19 & Tailwind CSS**, **AES-256-GCM KMS**, and **Deterministic Financial Ledgers**.

---

## 🏛️ Core Architectural Principle

```
AI INTERPRETS.
DETERMINISTIC SOFTWARE DECIDES.
POSTGRESQL OWNS TRUTH.
```

- **Zero AI in the Financial Path**: AI/LLMs parse unstructured chat entities, but NEVER calculate prices, authorize order dispatches, modify customer balances, or declare payment receipts.
- **PostgreSQL Row Locking (`FOR UPDATE`)**: Prevents race conditions, double allocations, concurrent loader dispatch collisions, and replay attacks.
- **Append-Only Ledgers**: `customer_balance_transactions` and `profit_ledger` are immutable. No updates or deletions; only append transactions with explicit balance continuity.
- **Zero Loss-Guarantee**: Group-aware `AUTO_PROFIT` pricing dynamically recalculates customer sale prices (`Assigned Loader Cost + Target Profit`) with 30-minute cooldown batching and 25% anomaly protection.

---

## 📦 Four Build Phases Breakdown

### ✅ Phase A — Complete Core Application Modules
1. **Schema & Persistence**: 72+ tables with strict foreign keys, check constraints, and unique indices (`001_initial_schema.sql`).
2. **KMS & Cryptography (`KmsManager`)**: Hardware-grade AES-256-GCM encryption at rest for customer credentials with key rotation, format masking, and audited plaintext reveal logging (`credential_access_log`).
3. **State Machine (`OrderStateTransitionService`)**: Deterministic lifecycle state machine (`INCOMPLETE -> PENDING -> SENT_TO_LOADER -> PROCESSING -> DONE`, legal cancellations, and reversal blocks).
4. **Customer Balance Ledger (`CustomerBalanceLedgerService`)**: Append-only transaction ledger with atomic balance updates (`CREDIT`, `DEBIT`, `REVERSAL_CREDIT`, `REVERSAL_DEBIT`).
5. **Profit & Loss Engine (`ProfitLedgerService`)**: Exact decimal profit realization on `DONE` orders (`Sale Price - Loader Cost`) with reversal offset handling.
6. **Dynamic Pricing Engine (`PricingEngine`)**: Group-aware price calculation, price profiles (Standard Retail vs VIP Wholesale), anomaly detection, and simulation.
7. **Loader Pricing (`LoaderPricingService`)**: Loader price book versioning with 30-minute cooldown batching.
8. **Order Management (`OrderService`)**: Monotonic sequences (`ORD-000001`), Activision/Facebook dynamic product validation, and encrypted secret storage.
9. **Payments Engine (`PaymentService`, `PaymentAllocationService`, `PaymentReversalService`)**: Deduplicated cryptocurrency TXIDs, verification state machine, FIFO multi-order allocations, and unwound reversals.
10. **Loader Delivery (`LoaderDeliveryService`)**: Outbox queue delivery, fulfillment rule compliance (`PAYMENT_REQUIRED` vs `FULFILL_REGARDLESS`), and reply-to message completion matching.
11. **Telegram Engine (`TelegramService`)**: Synchronous update logging, group-aware `/prices` and `/pay`, and supergroup migration.
12. **Session Calculator (`CalculatorService`)**: Telegram session arithmetic total, `/calc`, `/total`, `/undo`, and `/clearcalc`.
13. **AI Entity Extractor (`AIExtractionService`)**: Multi-lingual token matching (Spanish, Portuguese, Russian, French, Turkish), quote stripping, and fallback deterministic extraction.
14. **Reconciliation Engine (`ReconciliationService`)**: Discrepancy detector for balances, unrecorded profits, and stale outbox jobs.
15. **RBAC & Governance (`AuthService`)**: Action-level permission matrix for staff accounts.
16. **Broadcast Engine (`BroadcastService`)**: Group targeting, live preview, and message pinning.
17. **React Dashboard Frontend (24 Modules)**: Complete dark-mode operational dashboard in `src/client/`.

---

### ✅ Phase B — Verification Suite (100% Pass Rate)
- **73 Automated Tests** across 8 test suites passing cleanly with Vitest:
  - `src/tests/unit/paymentAllocation.test.ts` (FIFO allocations, partial payments, surplus credit, reversals)
  - `src/tests/unit/pricingEngine.test.ts` (Dynamic pricing, historical snapshot immutability, anomaly guards)
  - `src/tests/unit/stateAndProfit.test.ts` (Order state transitions, idempotent profit realization)
  - `src/tests/unit/cryptoAndSecurity.test.ts` (AES-256-GCM encryption, decryption, masked view, access logs)
  - `src/tests/integration/multiMessageOrder.test.ts` (Multi-message collation, country code phone validation, group-aware commands, supergroup migration)
  - `src/tests/integration/loaderFulfillmentFlow.test.ts` (FULFILL_REGARDLESS vs PAYMENT_REQUIRED, screenshot completion, profit trigger)
  - `src/tests/golden/goldenDataset.test.ts` (50 distinct real-world Golden Dataset scenarios)
  - `src/tests/reconciliation/reconciliation.test.ts` (Automated discrepancy detection & balance verification)

---

### ✅ Phase C — Staging Configuration & Seeding
Pre-configured in `src/core/db/seedStaging.ts` and auto-seeded on initial startup:
- **Owner & Staff Users**: `owner` (Full RBAC `*`), `staff_alex`
- **Products & Fields**: Activision (Email/Phone + Pass), Facebook (Phone with Country Code + Pass + 2FA Backup Codes)
- **CP Bundles**: 420 CP, 880 CP, 2400 CP, 5000 CP, 10800 CP
- **Loaders**: `LOADER_ALPHA` (Assigned to Standard Group), `LOADER_BETA` (Assigned to VIP Wholesale)
- **Price Profiles**:
  - `STANDARD_RETAIL`: Auto Profit (+$3.00 margin)
  - `WHOLESALE_VIP`: Auto Profit (+$1.50 margin)
- **Customer Groups**:
  - `-1001000000001` (Standard Retail Group, Fulfill Regardless)
  - `-1001000000002` (VIP Wholesale Group, Payment Required)
- **Payment Profiles**: Default Global Wallet + VIP Dedicated Wallet (Binance ID, Bybit UID, TRC20, BEP20)
- **Safeguards**: 25% max step increase, $15 max change, 30-min cooldown window

---

### ✅ Phase D — Deployment on Railway & Live Integrations

```
                               ┌─────────────────────────────────┐
                               │     Railway Cloud Container    │
                               │  (Node.js 20 + TypeScript API)  │
┌───────────────────────────┐  │                                 │
│  Telegram Bot API Webhook ├─►│  /api/webhooks/telegram         │
└───────────────────────────┘  │  - Synchronous Update Log       │
                               │  - Multi-Message Entity Parser  │
┌───────────────────────────┐  │  - State Machine & Outbox       │
│  Exchange API (Binance)   ├─►│                                 │
└───────────────────────────┘  │  /api/payments/ingest           │
                               │  - Deduplicated TXID Validation │
┌───────────────────────────┐  │  - FIFO Allocation Ledger       │
│  React 19 Dashboard UI    ├─►│                                 │
└───────────────────────────┘  │  /dist (Static Production SPA)  │
                               └────────────────┬────────────────┘
                                                │
                                                ▼
                               ┌─────────────────────────────────┐
                               │       Railway PostgreSQL        │
                               │   (72+ Tables, ACID Ledgers)    │
                               └─────────────────────────────────┘
```

---

## 🛠️ Quickstart Commands

### 1. Run Automated Test Suite (73 Tests)
```bash
npm test
```

### 2. Build for Production
```bash
npm run build
```

### 3. Run Development Server (Backend + Vite Frontend)
```bash
npm run dev
```

### 4. Run Production Server
```bash
npm start
```

---

## 🚀 Deployment Instructions (GitHub & Railway)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "🚀 Complete iTech Avengers Bot Engine v1.0.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/itech-avengers-bot.git
git push -u origin main
```

### Step 2: Deploy on Railway
1. Log in to [Railway.app](https://railway.app).
2. Click **New Project** → **Deploy from GitHub repo** → select `itech-avengers-bot`.
3. In the project canvas, click **+ New** → **Database** → **Add PostgreSQL**.
4. Link the PostgreSQL service to your `itech-avengers-bot` web service (Railway automatically injects `DATABASE_URL`).
5. Configure Environment Variables under the **Variables** tab (see `.env.example`):
   - `PORT=3000`
   - `TELEGRAM_BOT_TOKEN=your_live_telegram_bot_token`
   - `KMS_PRIMARY_KEY_HEX=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`
   - `BINANCE_API_KEY=your_binance_key` (if connecting live exchange)
   - `BYBIT_API_KEY=your_bybit_key` (if connecting live exchange)
6. Railway builds using the included `Dockerfile` and boots the full application.

---

## 🔒 Security & Data Minimization
- Customer credentials in `order_field_values` are stored as AES-256-GCM encrypted ciphers.
- All dashboard views show masked previews (`user***@gmail.com`, `••••••••`).
- Plaintext reveal actions require a documented purpose and are logged in `credential_access_log` with staff username, IP address, and timestamp.
- Outbound AI parsing prompts use regex sanitizers to mask passwords and tokens before invoking any external provider.

---

## 📊 24 Dashboard Modules
1. **Overview**: Executive financial cards, active orders, and loader status.
2. **Pending Orders**: Staff cards with masked secrets, reveal auditing, and "Are you sure?" dispatch modals.
3. **All Orders**: Searchable database ledger with status and group filters.
4. **Partial Payments**: Outstanding customer balances with formatted reminder dispatch.
5. **Payments & Queue**: Ingestion queue, verification actions, FIFO allocation, and reversals.
6. **Customers & Groups**: Route assignments, price profiles, and supergroup migration.
7. **Products**: Dynamic field definitions and CP tiers.
8. **Loaders**: Availability toggles and price book versions.
9. **Routing Matrix**: Group to loader assignments (`PAYMENT_REQUIRED` vs `FULFILL_REGARDLESS`).
10. **Loader Prices**: Cost sheet editor, 30-min cooldown batching, and price simulation.
11. **Price Profiles**: Margin profiles (Standard Retail vs VIP Wholesale).
12. **Current Prices**: Live customer price matrix.
13. **Purchase Costs**: Comparative loader cost grid.
14. **Promotions**: Loss-guarded fixed sales.
15. **Pricing Health**: Anomaly monitor and negative margin shield.
16. **Profit & Loss**: Gross profit, reversal offsets, and net active ledger.
17. **Payment Profiles**: Global and VIP wallet configurations.
18. **Broadcasts**: Announcement composer with live Telegram preview and pinning.
19. **Calculator**: Session running total with `/undo` and `/clearcalc`.
20. **Staff & Roles**: Action-level RBAC permission matrix.
21. **Message Templates**: Formatted Telegram response strings.
22. **Notifications**: System alerts with severity filtering.
23. **Reconciliation**: Automated integrity scanner and discrepancy detector.
24. **Audit Logs**: Searchable audit trace with correlation IDs and state diffs.
25. **Settings & Mode**: System mode selector (NORMAL / SAFE_MODE / READ_ONLY) and feature flags.

---
*iTech Avengers Bot Engine v1.0.0 — Built to strict enterprise specifications.*
