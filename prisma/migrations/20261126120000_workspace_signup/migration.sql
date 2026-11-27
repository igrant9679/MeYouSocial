-- Sign-up from both places (2026-11-26): Publisher's own sign-up page starts a 14-day trial
-- workspace, and a meyousocial.com membership creates (or keeps) one through signed calls to
-- /api/membership/events. Workspaces record where they came from, when a trial ends and a hold;
-- people record their one trial; grants and the event log record what the website said.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "signupSource" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MembershipGrant" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'meyousocial.com',
    "externalMemberId" TEXT NOT NULL,
    "externalPlanId" TEXT NOT NULL,
    "planName" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "access" TEXT NOT NULL,
    "workspaceId" TEXT,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "invitationId" TEXT,
    "revokedMembershipId" TEXT,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "email" TEXT,
    "externalMemberId" TEXT,
    "externalPlanId" TEXT,
    "outcome" TEXT,
    "detail" TEXT,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "grantId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MembershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipGrant_email_idx" ON "MembershipGrant"("email");

-- CreateIndex
CREATE INDEX "MembershipGrant_workspaceId_idx" ON "MembershipGrant"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipGrant_source_externalMemberId_externalPlanId_key" ON "MembershipGrant"("source", "externalMemberId", "externalPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipEvent_eventId_key" ON "MembershipEvent"("eventId");

-- CreateIndex
CREATE INDEX "MembershipEvent_receivedAt_idx" ON "MembershipEvent"("receivedAt");

-- AddForeignKey
ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
