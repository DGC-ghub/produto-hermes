import { redirect } from 'react-router'
import { logoutOperator } from '../lib/auth.server'
import type { Route } from './+types/logout'

export async function action({ request }: Route.ActionArgs) {
  return logoutOperator(request)
}

// Logout é por POST (botão "Sair"). Acesso direto via GET só volta ao login.
export async function loader() {
  throw redirect('/login')
}
