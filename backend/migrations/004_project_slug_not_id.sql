-- P- belongs to project IDs: scoped lookups interpret it as an ID, not a slug.
CREATE TRIGGER projects_slug_not_project_id_insert
BEFORE INSERT ON projects
WHEN lower(substr(NEW.slug, 1, 2)) = 'p-'
BEGIN
  SELECT RAISE(ABORT, 'Project slug cannot start with P-: use a slug such as frappe-cicd; the project ID is generated automatically.');
END;

CREATE TRIGGER projects_slug_not_project_id_update
BEFORE UPDATE OF slug ON projects
WHEN lower(substr(NEW.slug, 1, 2)) = 'p-'
BEGIN
  SELECT RAISE(ABORT, 'Project slug cannot start with P-: use a slug such as frappe-cicd; the project ID is generated automatically.');
END;
