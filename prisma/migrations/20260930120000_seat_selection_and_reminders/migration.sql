-- Attendance choice for Day 7 (seat at the venue, or online)
DO $$ BEGIN
  CREATE TYPE "AttendanceMode" AS ENUM ('IN_PERSON', 'ONLINE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "attendanceMode" "AttendanceMode";
ALTER TABLE "Registration" ADD COLUMN IF NOT EXISTS "attendanceChosenAt" TIMESTAMP(3);

-- Existing seat holders are attending in person.
UPDATE "Registration" r SET "attendanceMode" = 'IN_PERSON', "attendanceChosenAt" = COALESCE(r."attendanceChosenAt", NOW())
WHERE r."attendanceMode" IS NULL AND EXISTS (SELECT 1 FROM "Seat" s WHERE s."registrationId" = r."id");

-- Email templates: the seat invite no longer prints the raw link (the button carries it),
-- and the payment reminder no longer lists bank details (the button opens the payment page).
-- Only rows that still have the old wording are changed, so anything you edited yourself is kept.
UPDATE "EmailTemplate"
SET "body" = E'Hi {{first_name}},\n\nYour payment has been confirmed. Thank you. You can now choose your seat for the Day 7 Graduation and Investor\'s Dinner using the button below.\n\nIf you will not be able to come to the venue in person, you can choose to attend online on the same page.'
WHERE "key" = 'seat_selection_invite' AND "body" LIKE '%?rid={{registration_id}}%';

UPDATE "EmailTemplate"
SET "subject" = 'A gentle reminder about your RIDGE registration',
    "body" = E'Dear {{first_name}},\n\nWe hope you are keeping well.\n\nThank you for registering for {{programme_name}}. We noticed that your payment has not been completed yet, and we would be delighted to have you with us from {{cohort_dates}}.\n\nIf you have already paid, thank you, and please disregard this note. You are welcome to upload your receipt at any time using the button below.\n\nOtherwise, the button below takes you back to the payment page, where you can choose the currency you prefer and the payment method that suits you.\n\nIf you have any questions or need a hand, simply reply to this email or reach us on WhatsApp. We are always happy to help.\n\nWarm regards,\nThe RIDGE Team'
WHERE "key" = 'payment_reminder' AND "body" LIKE '%{{payment_account_number}}%';
