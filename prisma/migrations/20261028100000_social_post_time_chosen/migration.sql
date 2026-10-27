-- Whether a person chose a post's exact time, as opposed to the queue placing
-- it in a slot (audit SOC-17). Existing rows read as queue-placed, as before.
ALTER TABLE "SocialPost" ADD COLUMN "timeChosen" BOOLEAN NOT NULL DEFAULT false;
