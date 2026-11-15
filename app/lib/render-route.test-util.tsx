import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createMemoryRouter,
  RouterProvider,
  UNSAFE_DataRouterNavigationContext,
} from 'react-router'

// Renderiza a tela de uma rota dentro de um router com dados REAL (só API pública do React
// Router), para os hooks `useNavigation`/`useActionData`/`<Form>`/`<NavLink>` funcionarem no
// ambiente node. Antes os testes montavam os contextos internos à mão, e isso quebrou na
// 8.5 (que separou os contextos). `navigation` simula uma submissão em voo; `actionData`, o
// desfecho de uma ação já concluída. Nada é submetido de verdade — só marcação.
export function renderRoute<L>(opts: {
  id: string
  path: string
  Screen: (props: { loaderData: L }) => ReactNode
  loaderData: L
  navigation?: Record<string, unknown>
  actionData?: unknown
}): string {
  const { id, path, Screen, loaderData, navigation, actionData } = opts
  const Component = () => (
    <UNSAFE_DataRouterNavigationContext.Provider
      value={{ navigation: { state: 'idle', ...navigation }, revalidation: 'idle' } as never}
    >
      <Screen loaderData={loaderData} />
    </UNSAFE_DataRouterNavigationContext.Provider>
  )
  const router = createMemoryRouter([{ id, path, Component }], {
    initialEntries: [path],
    hydrationData: {
      loaderData: { [id]: loaderData },
      actionData: actionData === undefined ? null : { [id]: actionData },
    },
  })
  return renderToStaticMarkup(<RouterProvider router={router} />)
}
