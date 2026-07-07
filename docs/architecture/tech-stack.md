# Tech Stack

| Category | Technology | Version | Purpose | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend Framework** | Next.js (React) | latest | Web Dashboard | Full-stack capabilities, SSR, and excellent developer velocity. |
| **Backend Framework** | NestJS | latest | Enterprise API | Provides architectural rigor (DI, modules) similar to Spring Boot but in TS. |
| **Mobile Framework** | Flutter | latest | Cross-platform POS | High-performance, pixel-perfect UI for Android/iOS/Desktop. |
| **Language** | TypeScript | latest | Primary Language | Standardized across Web and Backend for E2E type safety. |
| **Database** | PostgreSQL | latest | Primary Data Store | Reliable relational database, hosted on the VPS (self-hosted PostgreSQL 15 in Docker). |
| **ORM** | Prisma | latest | Database Access | Type-safe database client shared across the TS monorepo. |
| **State Management** | Zustand | latest | Frontend State | Simple, lightweight state for the web dashboard. |
| **API Style** | REST | N/A | Communication | Standardized RESTful endpoints for Frontend and Mobile consumption. |
| **Infrastructure** | Docker | N/A | Containerization | Ensures "build once, run anywhere" portability and consistency. |
| **Hosting** | Self-managed Ubuntu VPS | N/A | Docker Compose + Caddy | Full control of the containerized stack; Caddy provides auto-TLS reverse proxy. |
| **Authentication** | Passport.js / JWT | latest | Auth & Security | Integrated into NestJS for robust, custom-managed authentication. |
| **File Storage** | AWS S3 / Cloudinary | N/A | Asset Storage | Standardized cloud storage for product images and documents. |
| **CI/CD** | GitHub Actions | N/A | Automation | Runs tests/builds; deploys are a manual SSH step (`scripts/deploy.sh`). |
| **Validation** | Zod | latest | Schema Validation | Shared schemas for frontend and backend request/response validation. |
| **CSS Framework** | Tailwind CSS | latest | Styling | Utility-first styling for the Next.js dashboard. |
