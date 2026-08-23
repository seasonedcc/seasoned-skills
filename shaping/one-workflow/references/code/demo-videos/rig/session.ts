import { db } from '~/db/db.server'
import { sessionStorage } from '~/sessions.server'
import type { Actor } from './screenplay'

/** Signs the demo in the way the product does, without filming a login. The
 *  screenplay names the person and the company out loud, because who is
 *  demoing is part of the story rather than a default to inherit. */
export async function sessionCookie(actor: Actor) {
  const user = await db()
    .selectFrom('users')
    .select('id')
    .where('email', '=', actor.userEmail)
    .executeTakeFirstOrThrow(
      () =>
        new Error(
          `The screenplay demos as ${actor.userEmail}, who is not in this database. Check the project's DEMO-STATE.md.`
        )
    )

  const company = await db()
    .selectFrom('companyDetailRevisions')
    .select('companyId')
    .where('name', '=', actor.companyName)
    .orderBy('createdAt', 'desc')
    .executeTakeFirstOrThrow(
      () =>
        new Error(
          `The screenplay demos inside ${actor.companyName}, which is not in this database. Check the project's DEMO-STATE.md.`
        )
    )

  const store = await sessionStorage().getSession()
  store.set('currentUserId', user.id)
  store.set('currentCompanyId', company.companyId)
  const setCookie = await sessionStorage().commitSession(store)

  return {
    name: '_app_session',
    value: setCookie.split(';')[0].split('=').slice(1).join('='),
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  }
}
