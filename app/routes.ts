import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('demo/chat', 'routes/demo.chat.tsx'),
  route('dashboard', 'routes/dashboard.tsx'),
  route('atendente', 'routes/atendente.tsx'),
  route('configuracoes', 'routes/configuracoes.tsx'),
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('signup', 'routes/signup.tsx'),
  route('verificar-email', 'routes/verificar-email.tsx'),
  route('assinar', 'routes/assinar.tsx'),
  route('webhook/mercadopago', 'routes/webhook.mercadopago.tsx'),
  route('webhook/whatsapp', 'routes/webhook.whatsapp.tsx'),
] satisfies RouteConfig
