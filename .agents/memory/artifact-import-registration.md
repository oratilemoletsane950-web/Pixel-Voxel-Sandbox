---
name: Imported artifact registration
description: Register Replit artifacts that arrive with a connected Git repository but are not yet in the project artifact list.
---

A connected repository can contain a valid artifact manifest without the project recognizing it as a registered artifact or configuring its workflow. Validating the existing manifest through Replit's artifact helper registered the imported app without recreating its source.

**Why:** The imported game source and manifest were present, but the artifact list and workflow did not include the game until the manifest was validated.

**How to apply:** After connecting a repository, compare its manifests with `listArtifacts()`. For an existing artifact that is missing, use the artifact validation helper with an unchanged temporary copy of its manifest, then use the workflow name returned by the newly configured project. Do not scaffold over the imported source.
