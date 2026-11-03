-- E-SHL-09: a personal timezone, and deleted (anonymised) accounts.
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);
