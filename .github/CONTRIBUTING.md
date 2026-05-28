# Contributing to Markr

Thanks for taking the time to contribute! A few ground rules to keep `main` always shippable.

---

## Branch → PR → Review → Merge

**Nothing goes directly into `main`.** Every change — including maintainer changes — must go through a pull request and receive at least one approval before merging.

```
your-fork or branch
    └── PR
         └── 1 approval required
              └── Squash merge into main
```

## Branch naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-slug>` | `feat/search-highlight` |
| Bug fix | `fix/<short-slug>` | `fix/toc-scroll-jump` |
| Chore / docs | `chore/<short-slug>` | `chore/update-readme` |
| Release | `release/vX.Y.Z` | `release/v3.6.0` |

## Commit messages

Follow the pattern used in this repo:

```
type: short description (vX.Y.Z if applicable)

- Bullet points for non-obvious details
```

Types: `feat` · `fix` · `chore` · `refactor` · `docs`

## Before opening a PR

```bash
npm run build   # must pass — no TypeScript errors
```

Test manually in the **Extension Development Host** (`F5` in VS Code).

## What reviewers check

- `npm run build` is green in the diff
- UI changes include a screenshot or screen recording
- No secrets, credentials, or API tokens committed
- Version bumped in `package.json` for publishable changes
- The PR is focused — one feature or fix per PR

## Reporting bugs / requesting features

Open an issue at **https://github.com/Apptware-Product-Labs/markr/issues**.  
Please include your VS Code version, OS, and a minimal `.md` file that reproduces the issue.

---

Built with ❤️ by [Apptware Labs Pvt Ltd](https://apptware.com)
