# Deploy-host docker cleanup (T-MEMORY-046)

Both GitLab runners (`$RUNNER_BACK`, `$RUNNER_FRONT`) execute on the same
deploy host (`savant`) against the same docker daemon, so their build cache
and images are shared and additive. Without cleanup, `docker build` layer
cache and versioned backend images grow unbounded across releases.

## Build cache

`docker builder prune -af` runs at the end of `backend:deploy` and
`front:deploy` in `.gitlab-ci.yml`. It only removes the docker buildx layer
cache (pure rebuild-time optimization, not an image or a running container),
so it is always safe. It fires on every production deploy — since either
side deploying clears the shared cache, it doesn't need its own scheduled
pipeline.

## Versioned backend images

`backend:deploy` builds and keeps `$BACKEND_CONTAINER_NAME:<tag>` for every
`backend-vX.Y.Z` release (`front:build`/`front:deploy` never keep a tagged
image — `front:build` already removes its own build tag after copying
`dist/` out). Rollback beyond a kept image is a `git checkout <tag>` +
rebuild, not a locally cached image, so old tags are pure disk cost.

`backend:deploy` keeps only the **3 most recent** `backend-vX.Y.Z` images
(sorted by version, newest first) and removes the rest with `docker rmi`.
The image the just-started container is running is always included in
those 3, since it was just built and tagged in the same job.

To change the retention count, edit the `tail -n +4` in `.gitlab-ci.yml`'s
`backend:deploy` job — `+4` keeps 3 images (drops from the 4th newest down);
`+6` would keep 5, etc.

## What this does not touch

- Running containers (`docker ps`) and their images — never pruned.
- Docker volumes — out of scope; audit separately if needed.
- Ad-hoc/manually-tagged images (e.g. old migration-era tags like
  `supersede-graphql`, `bilingual-fts`) are not produced by CI anymore
  post-monorepo-merge (D-MEMORY-023) and were cleaned up manually once; the
  retention rule above only recognizes the `backend-vX.Y.Z` tag shape, so a
  stray manual tag would need manual removal too.
