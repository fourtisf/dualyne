-- Leaderboard categories: each comparison and vote gets one; ratings are kept per category.
ALTER TABLE "CompareRun" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "Vote" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'general';

-- EloRating is rebuilt from votes by the nightly job, so its key can change in place.
ALTER TABLE "EloRating" DROP CONSTRAINT "EloRating_pkey";
ALTER TABLE "EloRating" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "EloRating" ADD CONSTRAINT "EloRating_pkey" PRIMARY KEY ("category", "modelId");
