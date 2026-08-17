ALTER TABLE evaluation_runs ADD COLUMN trigger_event_id UUID NULL;
CREATE UNIQUE INDEX evaluation_runs_trigger_event_uidx ON evaluation_runs (tenant_id, trigger_event_id) WHERE trigger_event_id IS NOT NULL;

ALTER TABLE evaluation_results ALTER COLUMN scenario_id DROP NOT NULL;
ALTER TABLE evaluation_results ADD COLUMN result_scope STRING NOT NULL DEFAULT 'scenario';
ALTER TABLE evaluation_results ADD CONSTRAINT evaluation_results_scope_check CHECK (
  (result_scope = 'scenario' AND scenario_id IS NOT NULL) OR
  (result_scope = 'suite' AND scenario_id IS NULL)
);
CREATE UNIQUE INDEX evaluation_results_suite_scope_uidx ON evaluation_results (tenant_id, evaluation_run_id) WHERE result_scope = 'suite';

GRANT SELECT, INSERT, UPDATE ON evaluation_runs, evaluation_results TO memory_ci_app;
