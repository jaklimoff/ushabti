-- A sprint is its own type now. A dated select named Sprint was one already.
UPDATE "properties" SET "type" = 'iteration'
WHERE "type" = 'select'
  AND lower(trim("name")) = 'sprint'
  AND "config"->>'dated' = 'true';
