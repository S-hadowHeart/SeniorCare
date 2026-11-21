-- AlterTable
ALTER TABLE "care_links" ADD COLUMN     "invitedEmail" TEXT,
ALTER COLUMN "caregiverId" DROP NOT NULL;
