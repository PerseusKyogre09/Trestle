# TRESTLE

TRESTLE — The Life-Event Compiler — is a tool for turning complex life events into clear, dependency-aware workflows with backend-enforced human approvals, interactive action graphs, and provider-agnostic execution.

## Status

This repository contains:
- **Rule-based workflow compiler**: Deterministic lost-wallet workflow compiler with independent branches for card security and identity document replacement (`src/domain/compiler.ts`).
- **Dependency & readiness engine**: Validates graph acyclicity, cross-graph isolation, and transition readiness (`src/domain/engine.ts`).
- **Interactive Action Graph**: Visual SVG-based directed acyclic graph layout with custom bezier connectors, interactive zoom/pan controls, status indicators, and drawer review (`src/domain/graph.ts`, `src/app/components/ActionGraph.tsx`).
- **Human approval & permission policy framework**: Central server-side risk classification, cryptographic payload hashing (SHA-256), approval lifecycles (pending, approved, rejected, expired, invalidated), and strict authorization enforcement (`src/server/policy.ts`, `src/server/approvalService.ts`).
- **Execution-provider abstraction & controller**: Provider interface, concurrency guards, failure/uncertainty reconciliation, outcome verification against success criteria, and a mock execution provider with explicit simulated labelling (`src/server/execution/`).
- **SQLite persistence with Prisma**: Persistent storage of cases, actions, approvals, and execution attempt audit trails (`src/server/repository.ts`, `prisma/schema.prisma`).
- **Case management & approval UI**: Interactive case dashboard, approval review panel, operation preparation modal, graph/list views, and execution audit history (`src/app/cases/[id]/page.tsx`).

*Planned integrations*: LLM-assisted workflow compilation, multi-user authentication/RBAC, and a real TinyFish browser automation adapter.

---

## Prerequisites

- Node.js 20.9 or newer (Node.js 22 LTS or newer recommended)
- npm 10 or newer
- Git

---

## Setup & Local Database Migrations

```bash
git clone <YOUR_REPOSITORY_URL>
cd trestle
npm install
cp .env.example .env.local
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

The development server is available at `http://localhost:3000`.

Prisma CLI reads `.env`, while Next.js reads `.env.local`. The application and
tests fall back to `DATABASE_URL="file:./dev.db"` when no environment file
exists, but keeping both files makes the setup explicit.

SQLite database is stored at `prisma/dev.db`. To apply new migrations or reset local data:
- `npm run db:migrate` — creates and applies Prisma migrations.
- `npm run db:reset` — resets local database for a clean state.

---

## Commands

```bash
npm test        # Runs all Vitest test suites (policy, crypto, approval lifecycle, execution controller, graph, engine, API)
npm run lint    # ESLint check across all TypeScript sources
npm run build   # Production build
npm start       # Start production server
```

---

## Architecture & Framework Details

### 1. The Approval Lifecycle

TRESTLE strictly distinguishes between distinct lifecycle stages:
1. **Planning**: Actions are structured in a dependency graph with prerequisites and success criteria.
2. **Preparing**: An action operation is constructed with target destination, operation type, and proposed payload data. Sensitive fields (passwords, OTPs, CVVs) are redacted.
3. **Requesting Approval**:
   - The backend validates action and case ownership.
   - Computes a canonical SHA-256 hash of the payload (`payloadHash`).
   - Evaluates the server-side permission policy.
   - Creates a persistent `pending` approval record with an expiration timestamp.
   - Transitions action status to `awaiting_approval`.
4. **Human Review & Decision**:
   - The user inspects the exact operation, destination URL, redacted payload, risk category, and cryptographic hash in the Approval Queue.
   - User decides to **Approve** or **Reject** with optional audit notes.
   - Stale or duplicate decisions are rejected. Expired requests cannot be approved.
5. **Immediate Pre-Execution Verification**:
   - Immediately prior to execution, the execution controller verifies:
     - The approval exists and belongs to the current case and action.
     - The approval is in `approved` status and has not expired.
     - The current execution payload's hash strictly matches the approved `payloadHash`.
     - Any payload modification immediately **invalidates** the approval.
6. **Execution & Outcome Verification**:
   - An authorised operation executes through the configured provider.
   - Action completion is verified against the action's success criteria. Intermediate steps (such as form filling) record progress but keep the action `in_progress`.

---

### 2. Action Risk and Permission Policy

The server-side policy module (`src/server/policy.ts`) enforces conceptual permission tiers independently of frontend or model requests:

- **Low risk** (`low_risk`):
  - *Examples*: Reading public guidance, inspecting official web pages, preparing drafts without submitting.
  - *Policy*: May run automatically when prerequisites are completed and provider permits.
- **Requires review** (`requires_review`):
  - *Examples*: Entering personal details into a form, selecting documents for upload, making consequential modifications to existing records.
  - *Policy*: Requires explicit human approval before the operation is permitted to execute.
- **High consequence** (`high_consequence`):
  - *Examples*: Submitting legal declarations, making financial payments, cancelling critical services, submitting final official applications.
  - *Policy*: Requires explicit, action-specific approval immediately before execution.
- **Prohibits automation** (`prohibitsAutomation: true`):
  - Where a service prohibits automated bots/tools or legally requires the user to act personally, automated execution is blocked and the user is directed to complete the task manually.

Website instructions and LLM outputs are treated as untrusted input and can never override server-side permission policy.

---

### 3. Execution-Provider Abstraction

The execution framework decouples workflow coordination from external automation tools:

- `ExecutionProvider` interface (`src/server/execution/types.ts`):
  - `checkEligibility(context)`: Checks provider readiness and operational constraints.
  - `execute(context)`: Executes an authorized operation and returns structured results and evidence.
  - `getStatus(attemptId)`: Queries ongoing status.
  - `cancel(attemptId)`: Cancels in-flight operations where supported.
- `providerRegistry` (`src/server/execution/registry.ts`):
  - Registry for execution adapters with support for pluggable providers.

---

### 4. Mock Execution Provider

The built-in `MockExecutionProvider` (`src/server/execution/mockProvider.ts`):
- Enables 100% offline, local testing without external API keys or live credentials.
- Strictly labels all results and evidence with `[SIMULATED]` and `isSimulated: true`.
- Simulates distinct real-world execution paths:
  - **Success**: Returns simulated outcome evidence with verified success criteria.
  - **Failure**: Returns simulated errors (triggered via `simulateFailure: true` in payload).
  - **Uncertainty**: Simulates network timeouts or unconfirmed third-party receipts (triggered via `simulateUncertainty: true` in payload), halting retries and requiring human reconciliation.

---

### 5. Execution Controller

The central `ExecutionController` (`src/server/execution/controller.ts`):
- Verifies workflow eligibility and dependency completion.
- Evaluates permission policy and validates approval currency.
- Uses an in-memory execution lock to prevent duplicate concurrent executions of the same action.
- Records all attempts in the `ExecutionAttempt` database table.
- Enforces strict outcome verification: intermediate form-fills do not mark actions `completed`.
- Treats uncertain outcomes safely by recording the uncertainty and avoiding blind retries.

---

### 6. Integrating a Future TinyFish Adapter

When TinyFish integration is ready, add an adapter adhering to the provider interface:

```typescript
// src/server/execution/tinyfishProvider.ts (Planned)
import type { ExecutionProvider, ExecutionContext, ProviderExecutionResult } from "./types";

export class TinyFishExecutionProvider implements ExecutionProvider {
  public readonly name = "tinyfish";

  async checkEligibility(context: ExecutionContext) {
    // Verify TinyFish API key and browser automation feasibility
    return { eligible: true, supportsOperation: true };
  }

  async execute(context: ExecutionContext): Promise<ProviderExecutionResult> {
    // 1. Invoke TinyFish browser automation session
    // 2. Perform authorised navigation and form population
    // 3. Collect screenshots, DOM state, and network receipts as evidence
    // 4. Return structured outcome
  }

  async getStatus(attemptId: string) { /* ... */ }
}

// Register in registry:
// providerRegistry.register(new TinyFishExecutionProvider());
```

Because the execution controller manages approvals, concurrency, and policy independently of provider implementations, adding TinyFish requires zero changes to the core approval lifecycle.

---

### 7. Security Architecture & Current Limitations

- **Backend Authority**: Approval state, cryptographic hashes, and completion criteria are enforced by Next.js Route Handlers and Prisma, not client-side state.
- **Payload Tampering Prevention**: Approvals store a deterministic SHA-256 hash of the payload with sorted keys. Any deviation between approved data and execution data invalidates the approval.
- **Sensitive Data Minimization**: `scrubSensitiveData` automatically redacts passwords, tokens, OTPs, CVVs, PINs, and SSNs from audit logs.
- **Local Development Security Notice**:
  - The application currently uses a local development identity model without a full session/RBAC provider.
  - Database foreign keys and API route parameters enforce case and action isolation (cross-case requests are rejected with 404).
  - Production deployments must integrate an authentication provider (e.g., NextAuth/Auth0/Clerk) to bind case ownership to authenticated user sessions.
