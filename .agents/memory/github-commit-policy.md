---
name: GitHub commit policy
description: Pixel Wilds changes should be committed and pushed to its configured GitHub remote after verification.
---

After completing and verifying Pixel Wilds changes, commit them to the connected GitHub repository and push to the current tracked branch.

**Why:** The user explicitly requested that changes always be committed to the connected GitHub repository. GitHub can still reject pushes when Replit reports its source-control connection as not added, even if attaching it reports it was already added.

**How to apply:** Check status and diffs first, stage only work completed for the task, run relevant checks, then make a normal commit and non-force push. If push authentication fails, keep the local commit and have the user reconnect GitHub in Replit Account Settings → Git Providers; do not ask for tokens or force-push.
