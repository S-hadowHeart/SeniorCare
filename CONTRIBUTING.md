# Contributing to SeniorCare

Thanks for your interest. This project uses a protected-`main` workflow: `main`
is always deployable, and every change arrives through a reviewed pull request.

## Workflow

1. **Branch from `main`.** Use a descriptive prefix:
   - `feat/` — new capability
   - `fix/` — bug fix
   - `refactor/` — behaviour-preserving change
   - `test/` — tests only
   - `docs/` — documentation only
   - `chore/` — tooling and dependencies
2. **Keep the branch focused.** One logical change per PR.
3. **Write meaningful commits.** Prefer [Conventional Commits](https://www.conventionalcommits.org/):
   `feat(medications): add weekly schedule expansion`.
4. **Run the checks locally** before opening the PR:
   ```bash
   npm run typecheck
   npm run lint
   ```
5. **Open a pull request** with a short description of the problem, the approach
   and how it was verified. Link any related issue.
6. **Review and merge.** Squash-merge into `main`; delete the branch afterwards.

## Code conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- Validate every external input with Zod at the boundary.
- Never log credentials, tokens or decrypted clinical text.
- Route handlers stay thin; domain rules live in services.
- Elder-scoped data must be accessed through `getElderAccess()`.
- Add an index when you add a query that scans by a new predicate.

## Security

- Do not commit secrets. Only `.env.example` is tracked.
- Report vulnerabilities privately rather than opening a public issue.
- New state-changing endpoints must enforce authentication, authorization and
  rate limiting.

## Review checklist

- [ ] The change has tests that fail without it.
- [ ] Typecheck and lint pass.
- [ ] No secrets, debug output or commented-out code.
- [ ] Error paths return the standard problem document.
- [ ] User-facing changes are reflected in the README or docs.
