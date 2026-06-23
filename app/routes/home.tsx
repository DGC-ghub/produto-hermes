import { Link } from 'react-router'
import type { Route } from './+types/home'

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Produto Hermes — MVP simulado' },
    { name: 'description', content: 'Simulador de atendimento com IA da DGC Hub' },
  ]
}

const WORKS = [
  'Memória por empresa (knowledge base)',
  'Busca de trechos relevantes (retrieval)',
  'Resposta com guardrails',
  'Chamada para humano (handoff)',
  'Persistência de conversas e mensagens',
  'Extração simples de leads',
  'Dashboard read-only',
]

const DEMOS = ['DGC Hub', 'ResolveTech Assistência (Demo)', 'Prestacon Contabilidade']

const OUT_OF_SCOPE = [
  'WhatsApp real',
  'Autenticação / produção',
  'Billing / SaaS completo',
  'Campanhas',
  'CRM completo',
]

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Produto Hermes</h1>
        <p className="text-lg text-gray-700">MVP simulado de atendimento com IA para WhatsApp</p>
        <p className="text-sm text-amber-700">
          Sem WhatsApp real ainda — simulação local com SQLite.
        </p>
      </header>

      <section className="flex flex-wrap gap-3">
        <Link
          to="/demo/chat"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Abrir simulador
        </Link>
        <Link
          to="/dashboard"
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700"
        >
          Ver dashboard
        </Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <ListCard title="O que já funciona" items={WORKS} />
        <ListCard title="Empresas demo" items={DEMOS} />
        <ListCard title="Fora do escopo do MVP" items={OUT_OF_SCOPE} />
      </section>

      <section className="space-y-1 text-sm text-gray-600">
        <h3 className="text-sm font-semibold text-gray-700">Documentos</h3>
        <p>
          Plano técnico:{' '}
          <a className="text-blue-600" href="/docs/plano-tecnico-mvp-simulado.md">
            docs/plano-tecnico-mvp-simulado.md
          </a>
        </p>
        <p>
          Backlog de segurança:{' '}
          <a className="text-blue-600" href="/docs/SECURITY-BACKLOG.md">
            docs/SECURITY-BACKLOG.md
          </a>
        </p>
      </section>
    </main>
  )
}
