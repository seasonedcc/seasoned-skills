## Killing a watchdog kills two processes

A watchdog launched as a background shell is two processes: the shell wrapper and the python child it spawned. Killing only the wrapper leaves the child alive and quietly sweeping a finished run. When a workflow ends, list both PIDs and kill each one exactly — never by pattern.
