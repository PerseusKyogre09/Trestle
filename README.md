# TRESTLE

TRESTLE — The Life-Event Compiler — is a tool for turning complex life events into clear, dependency-aware workflows with backend-enforced human approvals, interactive action graphs, and provider-agnostic execution.

## Status

This repository contains:
- **Rule-based workflow compiler**: Deterministic lost-wallet workflow compiler with independent branches for card security and identity document replacement (`src/domain/compiler.ts`).
- **Dependency & readiness engine**: Validates graph acyclicity, cross-graph isolation, and transition readiness (`src/domain/engine.ts`).
- **Interactive Action Graph**: Visual SVG-based directed acyclic graph layout with custom bezier connectors, interactive zoom/pan controls, status indicators, and drawer review (`src/domain/graph.ts`, `src/app/components/ActionGraph.tsx`).
- **Human approval & permission policy framework**: Central server-side risk classification, cryptographic payload hashing (SHA-256), approval lifecycles (pending, approved, rejected, expired, invalidated), and strict authorization enforcement (`src/server/policy.ts`, `src/server/approvalService.ts`).
- **Execution-provider abstraction & controller**: Provider interface, concurrency guards, failure/uncertainty reconciliation, outcome verification against success criteria, and a mock execution provider with explicit simulated labelling (`src/server/execution/`).
- **Autonomous workflow runs**: Persistent run status, provider event trace, pause/resume, duplicate-run protection, and recovery to an uncertain state after a server restart (`src/server/workflowOrchestrator.ts`). The scheduler follows the persisted action sequence and dependency graph from the earliest unfinished eligible task. It runs only actions with a real, policy-approved provider; it pauses for user action or approval rather than skipping ahead or substituting mock execution.
- **SQLite persistence with Prisma**: Persistent storage of cases, actions, approvals, execution attempts, and workflow runs (`src/server/repository.ts`, `prisma/schema.prisma`).
- **Case management & approval UI**: Interactive case dashboard, approval review panel, operation preparation modal, graph/list views, and execution audit history (`src/app/cases/[id]/page.tsx`).

*Limitations*: No multi-user authentication/RBAC; TinyFish is limited to read-only lost-document research. The live browser preview is watch-only. Direct browser control and consequential service actions are not implemented.

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

### 6. TinyFish research and workflow runs

The case page has **Start workflow** and **Guided** modes. Autonomous mode starts at the first unfinished task in persisted workflow order whose prerequisites are complete. TinyFish research runs automatically when it is the next eligible action. Tasks without an implemented real provider become a user-action gate; they are not skipped, and the mock provider is never substituted. A matching approval resumes orchestration and triggers execution without a separate Execute click. Each event is persisted as it arrives and the page polls persisted run state so progress, the provider run ID, preview URL, research result, and source links survive refreshes. TRESTLE advances only when the existing controller verifies the action's completion criteria, including procedure details and at least one recognized official-domain source. Other HTTPS URLs remain visible but do not count as official verification.

TinyFish's Agent `STREAMING_URL` can be embedded as a real, read-only preview, with an **Open live browser** link shown as a fallback. The Agent preview does not let the user interact with the browser. The interactive Browser API/CDP viewer is a separate session; TinyFish Agent SSE does not attach to that session, so it does not autonomously operate the viewer. Guided help uses workflow definitions and persisted provider progress only; TRESTLE cannot inspect the Agent preview's live DOM or see user-entered values. The workflow stops for the user's own action when no supported provider capability exists. It never submits applications, uploads documents, changes accounts, pays fees, or claims those outcomes.

### Shared browser

The Workflow Copilot's shared browser now resolves its starting page from the earliest eligible persisted workflow action. For lost-card actions, it uses an exact bank name in the saved case or the optional institution field to select a public support page from a small verified Indian issuer directory (HDFC Bank, ICICI Bank, SBI Card, State Bank of India debit cards, and Axis Bank). If the issuer is unknown or ambiguous, TRESTLE asks for the institution instead of guessing. For other workflows, it can open a non-simulated official source already persisted by TinyFish research for the current action or one of its prerequisites. If no such source exists, run the approved research step first; TRESTLE does not invent a site.

The session is created at `about:blank`, then TRESTLE attaches server-side CDP, installs document-navigation interception, and navigates to the selected URL. Normal case navigation and redirects are restricted to the selected official domain. The UI records and displays the selected URL, its source, why it was selected, and the action it supports. The page view is the actual remote browser and user input controls that session; the normal case path is guided and user-controlled. It does not block cards, submit forms, or claim account changes. The fixed number-field interaction exists only for the explicit harmless development test mode.

To open a user-entered site locally, expand **Open a custom public website (local development)** and enter its URL. This path accepts public HTTP/HTTPS sites and their public redirects, but blocks localhost, private IPs, and internal hostnames; it is disabled in production. It is for user-guided viewing only and does not make the site an official source or complete a workflow action. The explicit harmless **Development test site** mode starts at `the-internet.herokuapp.com` and also allows user navigation to other public sites through the URL bar, with private/internal destinations blocked. Set `TRESTLE_BROWSER_TEST_MODE=true` to enable it. The test site is never a case fallback. Shared browser sessions are billable, local-development-only because the application has no authentication, and expose neither the CDP URL nor TinyFish credentials to the client. End sessions when done; TinyFish documents inactivity-based termination and an explicit session delete endpoint. Check your TinyFish wallet and plan before starting a session.

Configure a local key with:

```bash
cp .env.example .env.local
# Set TINYFISH_API_KEY in .env.local only; never commit this file.
```

Live research uses the server-side `TINYFISH_API_KEY`; mock execution remains a separate, explicitly `SIMULATED` option. Read-only research is policy-eligible to run automatically after a user starts an autonomous workflow. High-consequence tasks remain user-controlled. The local app currently has no authentication or multi-user authorization, so keep live use to a local demo.

Apply additive database migrations with `npx prisma migrate deploy`. Do not use `npm run db:reset` to install the workflow-run schema; it deletes local data. To stop scheduling, use **Pause after current task**. A running provider operation is not reported as cancelled. After a server restart, an interrupted run is marked uncertain and is not retried automatically.

### AI privacy boundary

Groq is a planning-only service. It receives a minimized `PlanningBrief` containing an event category, a coarse jurisdiction when recognized, generic document types, and a fixed planning goal. It does not receive the raw user prompt, case records, names, addresses, contact details, document numbers, account values, form fields, files, or execution tools. Groq output is untrusted and must pass Zod validation and dependency-graph validation before a case is persisted.

TinyFish receives only the explicitly approved generic research operation: a jurisdiction and document type. It never receives private case data, completed form values, uploaded documents, account information, or credentials. TRESTLE remains the only component that owns persistence, approvals, dependency checks, provider invocation, and action status transitions.

The privacy boundary is conservative rather than a guarantee of perfect anonymization. Email addresses, phone-like values, common account/document-number patterns, and similar sensitive values are rejected before an outbound request. If the event cannot be safely reduced to a generic brief, the user must reformulate it without personal details.

The implementation lives in `src/server/execution/tinyfishProvider.ts` and is registered beside the mock provider. Because the execution controller manages approvals, concurrency, and policy independently of provider implementations, the adapter uses the existing approval lifecycle and execution history.

---

### 7. Security Architecture & Current Limitations

- **Backend Authority**: Approval state, cryptographic hashes, and completion criteria are enforced by Next.js Route Handlers and Prisma, not client-side state.
- **Payload Tampering Prevention**: Approvals store a deterministic SHA-256 hash of the payload with sorted keys. Any deviation between approved data and execution data invalidates the approval.
- **Sensitive Data Minimization**: `scrubSensitiveData` automatically redacts passwords, tokens, OTPs, CVVs, PINs, and SSNs from audit logs.
- **Local Development Security Notice**:
  - The application currently uses a local development identity model without a full session/RBAC provider.
  - Database foreign keys and API route parameters enforce case and action isolation (cross-case requests are rejected with 404).
  - Production deployments must integrate an authentication provider (e.g., NextAuth/Auth0/Clerk) to bind case ownership to authenticated user sessions.
