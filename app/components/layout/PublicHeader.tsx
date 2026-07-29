import { Link } from 'react-router'
import { Logo } from '../brand/BrandMark'
import { Button } from '../ui/Button'

/** Casca pública: header magro com a marca e os CTAs. */
export function PublicHeader() {
  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-4 sm:px-6">
      <Link to="/" aria-label="Hermes — início">
        <Logo />
      </Link>
      <nav className="ml-auto flex items-center gap-5 text-sm text-ink-soft">
        {/* Em telas estreitas o "Demo" sai: a linha só cabe marca + Entrar + CTA. */}
        <Link to="/demo/chat" className="hidden transition-colors hover:text-ink sm:inline">
          Demo
        </Link>
        <Link to="/login" className="transition-colors hover:text-ink">
          Entrar
        </Link>
      </nav>
      {/* Quem chega sem conta precisa cair no cadastro, não numa tela pedindo senha. */}
      <Link to="/signup">
        <Button variant="primary">Testar grátis</Button>
      </Link>
    </header>
  )
}
