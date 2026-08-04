# Repository hygiene

- `.github/workflows/pipeline.yml` is the only permanent GitHub Actions workflow.
- Pull requests run checks and a Windows validation build.
- Main-branch version changes build all release platforms and publish the matching tag.
- The main-branch cleanup job removes merged work branches and legacy workflow-run history.
- One-time migration workflows and payload files must be removed before a pull request is merged.
