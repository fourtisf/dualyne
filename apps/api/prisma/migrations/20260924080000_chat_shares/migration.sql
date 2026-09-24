-- CreateTable
CREATE TABLE "ChatShare" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "deleteTokenHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatShare_createdAt_idx" ON "ChatShare"("createdAt");

