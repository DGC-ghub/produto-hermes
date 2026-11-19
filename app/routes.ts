import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('demo/chat', 'routes/demo.chat.tsx'),
  route('demo/nota-exemplo', 'routes/demo.nota-exemplo.tsx'),
  route('api/asaas/webhook', 'routes/api.asaas.webhook.tsx'),
  route('dashboard', 'routes/dashboard.tsx'),
] satisfies RouteConfig
