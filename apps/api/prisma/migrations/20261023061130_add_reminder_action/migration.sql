-- AlterTable
ALTER TABLE "events" ADD COLUMN     "fromReminderId" UUID;

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "actionPayload" JSONB,
ADD COLUMN     "eventType" TEXT;
