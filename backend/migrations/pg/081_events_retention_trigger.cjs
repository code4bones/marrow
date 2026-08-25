// T-context (2026-08-25, owner's ask): events grows unbounded -- every
// task/decision/memory/artifact/link/project write funnels through the one
// shared recordEventForProject() insert (base.ts), and nothing ever prunes
// old rows. Owner's direction: not a cron sweep, a DB trigger -- so the
// moment a new event lands (e.g. inserting a task fires the trigger chain:
// task insert -> recordEventForProject's events insert -> this trigger),
// the project's own event history gets trimmed back down to the retention
// window in the same transaction, no separate scheduled job/process needed.
// Retention: 500 most-recent events per project_id, and 500 more for
// project_id IS NULL (common-scope events), same limit, tracked separately.
exports.up = async function up(knex) {
  await knex.schema.raw("create index idx_events_project_id_created_at on events(project_id, created_at desc)");

  await knex.schema.raw(`
    create or replace function trim_project_events() returns trigger as $$
    begin
      delete from events
      where coalesce(project_id, '') = coalesce(new.project_id, '')
        and id not in (
          select id from events
          where coalesce(project_id, '') = coalesce(new.project_id, '')
          order by created_at desc, id desc
          limit 500
        );
      return new;
    end;
    $$ language plpgsql;
  `);

  await knex.schema.raw(`
    create trigger trg_trim_project_events
    after insert on events
    for each row
    execute function trim_project_events();
  `);
};

exports.down = async function down(knex) {
  await knex.schema.raw("drop trigger if exists trg_trim_project_events on events");
  await knex.schema.raw("drop function if exists trim_project_events()");
  await knex.schema.raw("drop index if exists idx_events_project_id_created_at");
};
