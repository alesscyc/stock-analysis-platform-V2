# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
alesscyc/stock-analysis-platform-V2. Use the gh CLI.

## Conventions

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open
- Comment: gh issue comment <number> --body-file <file>
- Apply labels: gh issue edit <number> --add-label "..."
- Remove labels: gh issue edit <number> --remove-label "..."
- Close: gh issue close <number> --comment "..."

Infer repository from git remote; outside this clone, pass
--repo alesscyc/stock-analysis-platform-V2.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

"Publish to the issue tracker" means create a GitHub issue.
"Fetch the relevant ticket" means read the referenced GitHub issue.
