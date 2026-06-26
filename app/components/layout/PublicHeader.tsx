import { Link } from 'react-router'
import { Logo } from '../brand/BrandMark'
import { Button } from '../ui/Button'

/** Casca pública: header magro com a marca e os CTAs. */
export function PublicHeader() {
  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface px-6 py-4">
      <Link to="/" aria-label="Hermes — início">
        <Logo />
      </Link>
      <nav className="ml-auto flex items-center gap-5 text-sm text-ink-soft">
        <Link to="/demo/chat" className="transition-colors hover:text-ink">
          Demo
        </Link>
        <Link to="/login" className="transition-colors hover:text-ink">
          Entrar
        </Link>
      </nav>
      <Link to="/login">
        <Button variant="primary">Testar grátis</Button>
      </Link>
    </header>
  )
}
