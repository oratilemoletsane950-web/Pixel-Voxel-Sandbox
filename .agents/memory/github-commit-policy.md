---
name: GitHub commit policy
description: Pixel Wilds changes should be committed and pushed to its configured GitHub remote after verification.
---

After completing and verifying Pixel Wilds changes, commit them to the connected GitHub repository and push to the current tracked branch.

**Why:** The user explicitly requested that changes always be committed to the connected GitHub repository. GitHub can still reject pushes when Replit reports its source-control connection as not added, even if attaching it reports it was already added.

**How to apply:** Check status and diffs first, stage only work completed for the task, run relevant checks, then make a normal commit and non-force push. If push authentication fails, keep the local commit and have the user reconnect GitHub in Replit Account Settings → Git Providers; do not ask for tokens or force-push.

**Attribution:** The repository owner (Oratile Moletsane <sebatamoletsane950@gmail.com>) must be the sole author and committer. Never add `Co-Authored-By: Codebuff`, a "Generated with Codebuff" line, or any other agent co-author trailer: GitHub credits co-authors as repository contributors, so such trailers make the agent look like the author. Existing pushed commits are left as-is; rewriting published history and force-pushing remain forbidden.
