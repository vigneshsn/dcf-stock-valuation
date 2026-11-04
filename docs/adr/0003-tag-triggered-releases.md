# Tag-triggered, approval-gated releases

Production deploys only on a `v*.*.*` tag on `main`: CI checks re-run as a gate, a `production` GitHub Environment requires manual approval, then the Angular app goes to GitHub Pages (www.valuestock360.com) and the Express backend to Render (native Node runtime, deploy hook pinned to the tagged commit SHA with Render auto-deploy off). One tag releases both; there is a single production deployment, so one Market edition (ADR 0002) set by Render env vars.

## Considered Options

- **Deploy on every push to main**: rejected; releases should be deliberate and traceable to a tag.
- **Docker image on a container host**: rejected for now; Render's native Node runtime avoids a Dockerfile and image scanning.
- **Separate frontend and backend versions**: rejected; the API base URL is baked into the frontend build, so the two ship together.
