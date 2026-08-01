-- Service transactions use ReviewStaff -> ModerationCase as their canonical
-- lock order. Keep a database-level barrier as well so a future assignment
-- path cannot attach work to a reviewer whose offboarding has committed.
CREATE OR REPLACE FUNCTION enforce_active_review_staff_assignment()
RETURNS trigger AS $$
DECLARE
  reviewer_status "ReviewStaffStatus";
BEGIN
  IF NEW."assignedToUserId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."assignedToUserId" IS NOT DISTINCT FROM OLD."assignedToUserId" THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT "status"
    INTO reviewer_status
  FROM "ReviewStaff"
  WHERE "id" = NEW."assignedToUserId"
  FOR KEY SHARE;

  IF reviewer_status IS DISTINCT FROM 'active'::"ReviewStaffStatus" THEN
    RAISE EXCEPTION 'moderation case assignment requires active ReviewStaff'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ModerationCase_active_review_staff_assignment"
BEFORE INSERT OR UPDATE OF "assignedToUserId" ON "ModerationCase"
FOR EACH ROW EXECUTE FUNCTION enforce_active_review_staff_assignment();
