# TRESTLE

TRESTLE — The Life-Event Compiler — is a planned tool for turning complex life events into clear, dependency-aware workflows.

## Status

This repository is currently an initial scaffold. It contains a minimal Next.js homepage only; product workflows, automation, and integrations are not implemented yet.

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
npm run dev
```

The development server is available at http://localhost:3000.

## Environment variables

Copy `.env.example` to `.env.local` for local development. The placeholders are optional and are not required for the application to start. Do not commit `.env.local` or any file containing secrets.

## Commands

```bash
npm run lint
npm run build
npm start
```

Run `npm start` only after a successful production build. `npm run lint` checks the codebase with ESLint.

## Planned architecture

The planned application will use Next.js App Router as its web layer, with typed domain logic that compiles life-event inputs into dependency-aware steps. Future work may add a persistence layer and a browser-automation boundary for executing eligible steps through TinyFish. These are planned integrations, not part of the current scaffold.

## Contributing

Create a focused branch from the default branch, make the smallest coherent change, and run `npm run lint` and `npm run build` before opening a pull request. Keep secrets and local environment files out of Git, and include a concise description of any user-facing or architectural change.
