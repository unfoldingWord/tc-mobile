# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately to the unfoldingWord engineering team via
<security@unfoldingword.org>, or through GitHub's private vulnerability
reporting once this repo exists in the org.

Include: what you found, how to reproduce it, and the impact you believe it
has. We will acknowledge within a few business days.

## Scope notes for this project

tC Mobile is an offline, client-side application. As of Phase 1 it has **no
backend, no authentication, and transmits nothing** — all recordings stay in
IndexedDB on the device.

The consequences worth thinking about are therefore mostly local:

- Audio recorded by translators is stored unencrypted in browser storage. Any
  other code running on that origin, or anyone with the unlocked device, can
  read it.
- No export path exists yet (#18). When one lands, exported MP3s will leave via
  the OS share sheet and be outside our control from that point.
- Recordings may contain personally identifying speech from vulnerable
  communities. Treat sample data accordingly and never commit real recordings
  to this repo.
