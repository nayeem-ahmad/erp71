-- Real-user page load timings for System Health → Page performance. Additive.
CREATE TABLE "PageTimingSample" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT NOT NULL,
    "nav_type" TEXT NOT NULL,
    "total_ms" INTEGER NOT NULL,
    "document_ms" INTEGER,
    "boot_ms" INTEGER NOT NULL,
    "data_ms" INTEGER NOT NULL,
    "render_ms" INTEGER NOT NULL,
    "api_calls" INTEGER NOT NULL,
    "network_ms" INTEGER NOT NULL,
    "server_ms" INTEGER NOT NULL,
    "db_ms" INTEGER NOT NULL,
    "token_wait_ms" INTEGER NOT NULL,
    "slowest_endpoint" TEXT,
    "slowest_ms" INTEGER,

    CONSTRAINT "PageTimingSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PageTimingSample_created_at_idx" ON "PageTimingSample"("created_at");
CREATE INDEX "PageTimingSample_route_created_at_idx" ON "PageTimingSample"("route", "created_at");
