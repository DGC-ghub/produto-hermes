import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('demo/chat', 'routes/demo.chat.tsx'),
] satisfies RouteConfig
