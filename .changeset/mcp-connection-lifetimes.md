---
'seasoned-skills': patch
---

The `mcp-server` skill's rules for the OAuth server no longer assume one
particular app's sessions. Signing out of the browser used to have to end
every connected assistant; now the project decides once whether a
connection lives and dies with the browser session that allowed it or
outlives it as its own grant, and either way the person can end it from a
page listing the apps that hold access. Credentials stay insert-only, but a
scheduled cleanup may delete client registrations nobody ever allowed, since
open registration lets anyone create them. Grants never live in process
memory; memory holds only what the app already accepts losing on a restart,
named in the design with the single-instance assumption it rests on. Expiry
may be computed from a row's creation time against the database clock, and
the demo seed carries clients and connections for the OAuth pages but never
a token, which would expire an hour after the seed ran.
