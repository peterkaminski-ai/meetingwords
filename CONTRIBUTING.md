# Contributing to MeetingWords

> **Status: adopted in draft.** This policy takes full effect when the repository becomes public; the CLA text gets a legal review before the first substantive contribution is accepted.

Thanks for wanting to improve MeetingWords. Contributions come in under one of two tiers, sized to the contribution.

## Small patches: DCO sign-off

Typo fixes, obvious bugs, documentation corrections, small test additions — anything where the change is more work to negotiate than to write — come in under the [Developer Certificate of Origin](#developer-certificate-of-origin-v11) with a signed-off commit:

```
git commit -s
```

That `Signed-off-by:` line certifies the DCO: the work is yours to give and you're giving it under this repository's license (CPAL-1.0). Inbound = outbound, nothing more. Maintainers may also apply the "obvious fix" judgment and take trivial corrections without ceremony.

## Substantive contributions: the CLA

Features, refactors, new modules, anything with real creative weight — these need the [Contributor License Agreement](CLA.md) once, before your first substantive PR is merged. Why a CLA exists here, in plain terms:

- **What you grant**: your copyright stays yours; you license your contribution to the project broadly, including the right to offer it under additional licenses (commercial exceptions are how the hosted service funds maintenance) and to migrate the project's license if that ever serves it — including to a *more permissive* one, which is impossible for any project that can't relicense inbound contributions.
- **What binds us in return** (the covenant in CLA §4, and it binds anyone who ever acquires these rights): your contribution, and every release containing it, will always also be available under an OSI-approved open-source license. Additional licenses can be added; the open license can never be subtracted. If we break that, the additional-licensing right ends.

To sign at current project scale: include the sentence "I agree to the MeetingWords Individual CLA (CLA.md, version 0.1)" in your PR description or an email to support@meetingwords.com, from an identity matching your commits. Tooling can replace this if volume ever demands it.

## Contributor thanks (policy, not contract)

Contributors are credited in [NOTICE](NOTICE). Substantial contributors additionally get a free Pro account (or equivalent instance credit) on the hosted service **for as long as the hosted service operates under our stewardship** — we can't bind a hypothetical future owner of the service, so we won't pretend to. What a future owner *would* inherit, bindingly, is the CLA covenant above: contributed code stays open regardless of who runs the service.

## Practical notes

- Match the codebase's idiom: comment density, naming, test style (`test/` is pure unit tests). Run `npm run typecheck && npm test` before submitting.
- The core stays deliberately small and runtime-pure (Cloudflare/workerd only, no hosted-service dependencies). Service-layer ideas belong in an issue, not a core PR — the service layer is a separate, private codebase.
- Security reports: email support@meetingwords.com rather than opening a public issue.

## Developer Certificate of Origin v1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
