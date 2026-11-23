-- +goose Up
-- Older TeamHub servers can accept the Sponsor's answer and enqueue decision.run.
-- Route before the job becomes visible so only a worker that knows Skill removal can claim it.
-- +goose StatementBegin
CREATE FUNCTION route_skill_unbind_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM decisions
        WHERE id = NEW.args->>'decision_id' AND kind = 'connector_write' AND request ? 'unbind'
    ) THEN
        NEW.kind := 'decision.skill_unbind';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER route_skill_unbind_job BEFORE INSERT ON river_job
FOR EACH ROW WHEN (NEW.kind = 'decision.run') EXECUTE FUNCTION route_skill_unbind_job();

-- An older River leader discards a stuck job of an unknown kind on its first
-- rescue. Keep the remaining attempts available to workers that can run it.
-- +goose StatementBegin
CREATE FUNCTION retry_skill_unbind_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.state := 'available';
    NEW.finalized_at := NULL;
    NEW.scheduled_at := now();
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER retry_skill_unbind_job BEFORE UPDATE OF state ON river_job
FOR EACH ROW WHEN (OLD.kind = 'decision.skill_unbind' AND OLD.state = 'running'
    AND NEW.state = 'discarded' AND NEW.attempt < NEW.max_attempts)
EXECUTE FUNCTION retry_skill_unbind_job();

-- +goose Down
-- A legacy worker must never execute an outstanding first-party tool confirmation.
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'the Skill unbind routing migration is forward-only'; END $$;
-- +goose StatementEnd
