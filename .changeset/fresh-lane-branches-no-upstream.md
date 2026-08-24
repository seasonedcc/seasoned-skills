---
'seasoned-skills': patch
---

A fresh lane branch is created without an upstream. Creating it from a
remote-tracking base made git adopt that base as the branch's upstream, so a
bare `git push` from the lane aimed at the base branch instead of failing
loudly and asking for the explicit refspec. Adopted origin branches already
avoided this; now new branches do too.
