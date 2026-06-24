import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('demo/chat', 'routes/demo.chat.tsx'),
  route('dashboard', 'routes/dashboard.tsx'),
  route('atendente', 'routes/atendente.tsx'),
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.tsx'),
] satisfies RouteConfig
