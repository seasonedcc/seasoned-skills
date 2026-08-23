import { access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserContext } from '@playwright/test'
import { PROJECTS_ROOT } from './project.js'
import type { Actor } from './screenplay.js'

/** The cookie the browser is given: whatever `context.addCookies` accepts. */
export type SessionCookie = Parameters<BrowserContext['addCookies']>[0][number]

/** Signs the demo in the way the product does, without filming a login. The
 *  screenplay names the person and the company out loud, because who is
 *  demoing is part of the story rather than a default to inherit.
 *
 *  How to sign in is the product's to say, so the rig does not know: the
 *  project commits `demo-videos/session.ts` beside its screenplays, and that
 *  module's default export turns the screenplay's actor into the signed
 *  session cookie. Its optional named export `close` is called once after the
 *  run, for a module that opened a database connection to look the actor up. */
type SessionModule = {
  sessionCookie: (actor: Actor) => Promise<SessionCookie>
  close?: (() => Promise<void>) | undefined
}

let loaded: SessionModule | null = null

async function loadSessionModule(): Promise<SessionModule> {
  if (loaded) return loaded

  const file = path.join(PROJECTS_ROOT, 'session.ts')
  const where = path.relative(process.cwd(), file)
  try {
    await access(file)
  } catch {
    throw new Error(
      `The rig signs the actor in directly — no login is ever filmed — and how to sign in is the product's to say. There is no session module at ${where}: the project commits one whose default export takes the screenplay's actor and returns the session cookie to give the browser. See "The session module" in rig/README.md.`
    )
  }

  const module = await import(pathToFileURL(file).href)
  if (typeof module.default !== 'function') {
    throw new Error(
      `${where} has no default export — the session module exports its actor-to-cookie function as default. See "The session module" in rig/README.md.`
    )
  }

  loaded = {
    sessionCookie: module.default as SessionModule['sessionCookie'],
    close: typeof module.close === 'function' ? module.close : undefined,
  }
  return loaded
}

export async function sessionCookie(actor: Actor): Promise<SessionCookie> {
  const project = await loadSessionModule()
  return project.sessionCookie(actor)
}

/** Lets the project's session module let go of whatever it opened — a
 *  database pool, usually. Safe to call when nothing was ever loaded. */
export async function closeSession() {
  if (loaded?.close) await loaded.close()
}
