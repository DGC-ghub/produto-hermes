import { Form, useLoaderData } from 'react-router'
import { db } from '~/db.server'
import type { Route } from './+types/notes'

export async function loader(_args: Route.LoaderArgs) {
  const notes = await db.note.findMany({ orderBy: { createdAt: 'desc' } })
  return { notes }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData()
  const content = String(formData.get('content') ?? '')
  if (content.trim()) {
    await db.note.create({ data: { content } })
  }
  return null
}

export default function Notes() {
  const { notes } = useLoaderData<typeof loader>()

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Notes</h1>

      <Form method="post" className="mb-6 flex gap-2">
        <input
          name="content"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Write a note…"
          required
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Add
        </button>
      </Form>

      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.id} className="rounded border border-gray-200 p-3 text-sm">
            <p>{note.content}</p>
            <p className="mt-1 text-xs text-gray-400">
              {new Date(note.createdAt).toLocaleString()}
            </p>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-gray-400">No notes yet. Add one above!</li>
        )}
      </ul>
    </main>
  )
}
