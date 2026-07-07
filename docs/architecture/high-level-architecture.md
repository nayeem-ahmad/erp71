# High Level Architecture

### Technical Summary

The ERP71 platform is architected as a **Containerized Monorepo**. It prioritizes **Type Safety** through an all-TypeScript web/backend core, while leveraging **Flutter** for a high-performance mobile POS. The system is deployed as Docker Compose services on a **self-managed Ubuntu VPS** (Docker Compose + Caddy), giving us full control of a containerized environment.

### Platform and Infrastructure Choice

**Platform:** Self-managed Ubuntu VPS
**Key Services:** Docker Compose services (Caddy auto-TLS reverse proxy, Next.js frontend, NestJS backend) and self-hosted PostgreSQL 15.
**Containerization:** Docker is used for all service deployments to ensure environment parity and portability.

### Repository Structure

**Structure:** Monorepo (using npm workspaces and Turborepo)
**Organization:**
- `apps/backend`: NestJS API (Node.js/TypeScript).
- `apps/frontend`: Next.js Web Dashboard.
- `apps/mobile`: Flutter Mobile Application.
- `packages/*`: Shared database schemas, types, and validation logic.

### High Level Architecture Diagram

```mermaid
graph TD
    subgraph Clients
        Web[Next.js Dashboard]
        Mobile[Flutter POS]
    end

    subgraph VPS
        Caddy[Caddy Reverse Proxy]
        FE[Next.js Frontend]
        API[NestJS Docker Container]
        DB[(PostgreSQL 15)]
    end

    subgraph External
        SMS[Twilio/SMS]
        Storage[S3/Cloudinary]
        Pay[bKash/Nagad]
    end

    Web --> Caddy
    Mobile --> Caddy
    Caddy --> FE
    Caddy --> API
    API --> DB
    API --> SMS
    API --> Storage
    API --> Pay
```

### Architectural Patterns

-   **Polyglot Monorepo:** Shared TypeScript types and validation across web/backend, with Flutter as a high-fidelity mobile consumer.
-   **Dependency Injection (NestJS):** Architecture inspired by Spring Boot for maintainability and testability in the backend.
-   **Docker-First Deployment:** Every application is containerized, ensuring that "what works locally works in production."
-   **Centralized API Gateway:** The NestJS backend serves as the single entry point for all business logic and external integrations.
