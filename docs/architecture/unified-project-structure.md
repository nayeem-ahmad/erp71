# Unified Project Structure

This section defines the monorepo structure that houses the frontend, backend, and mobile applications, along with shared logic.

```plaintext
retail/
├── .github/                    # CI/CD workflows (e.g., deploy to Render)
│   └── workflows/
│       └── main.yaml
├── apps/                       # The individual applications
│   ├── backend/                # NestJS (Node.js/TypeScript) API
│   │   ├── src/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── frontend/               # Next.js (TypeScript) Web Dashboard
│   │   ├── src/
│   │   ├── public/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── mobile/                 # Flutter (Dart) Mobile App
│       ├── lib/
│       ├── pubspec.yaml
│       └── README.md
├── packages/                   # Shared code between applications
│   ├── database/               # Prisma schema and generated client
│   ├── shared-types/           # Shared TypeScript types/interfaces
│   └── validation/             # Shared Zod schemas for E2E validation
├── docker-compose.yml          # Local development environment
├── package.json                # Root package.json for npm workspaces
└── turbo.json                  # Turborepo configuration for build orchestration
```
