# TRESTLE

TRESTLE — The Life-Event Compiler — is a planned tool for turning complex life events into clear, dependency-aware workflows.

## Status

This repository now contains the first functional foundation: a deterministic lost-wallet workflow compiler, dependency validation/readiness engine, SQLite persistence through Prisma, case APIs, and a case-management UI. TinyFish, LLM compilation, authentication, and secure approval enforcement are not implemented.

## Prerequisites

- Node.js 20.9 or newer (Node.js 22 LTS is recommended)
- npm 10 or newer
- Git

## Setup

```bash
git clone <YOUR_REPOSITORY_URL>
cd trestle
npm install
cp .env.example .env.local
npm run db:generate
npm run db:migrate -- --name init
npm run dev
```

The development server is available at http://localhost:3000.

## Environment variables and database

Copy `.env.example` to `.env.local` for local development. `DATABASE_URL="file:./dev.db"` stores the SQLite database in the Prisma directory. Run `npm run db:generate` and `npm run db:migrate -- --name init` after installing dependencies. Reset local data with `npm run db:reset`. The database file is ignored by Git.

## Commands

```bash
npm run lint
npm test
npm run build
npm start
```

Run `npm start` only after a successful production build. `npm run lint` checks the codebase with ESLint and `npm test` runs the domain tests.

## Architecture

- `src/domain/types.ts` and `validation.ts` define the reusable domain model and request schemas.
- `src/domain/compiler.ts` exposes the provider-independent `WorkflowCompiler` interface and the current explicit rule-based compiler.
- `src/domain/engine.ts` validates dependency graphs, calculates readiness, and enforces action transitions.
- `src/server/repository.ts` is the persistence boundary; React components do not access Prisma directly.
- `src/app/api/` contains Route Handlers for case creation/retrieval and action transitions.

The supported scenario is a lost wallet involving cards or identity documents. The compiler creates independent card-security and document-reporting branches, then chains dependent follow-up tasks. It does not browse official sites or infer jurisdiction-specific obligations; those steps explicitly require verification.

## Planned architecture

The current application uses Next.js App Router, typed domain logic, Prisma, and SQLite. Planned work includes a visual graph, LLM-assisted compilation with validation, enforceable human approvals, and TinyFish-powered execution. Those capabilities are not implemented yet, and simulated or user-provided evidence is never treated as verified external success.

## Contributing

Create a focused branch from the default branch, make the smallest coherent change, and run `npm run lint` and `npm run build` before opening a pull request. Keep secrets and local environment files out of Git, and include a concise description of any user-facing or architectural change.
