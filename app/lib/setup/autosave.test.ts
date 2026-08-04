import { describe, expect, it } from 'vitest'
import {
  type AutosaveState,
  autosaveInicial,
  autosaveReducer,
  deveAutosalvar,
  navegacaoPendente,
  podeNavegar,
  revisaoParaEnviar,
} from './autosave'

// A máquina do autosave da tela de onboarding. Está aqui, pura, porque é LÓGICA — e
// porque a versão anterior tinha três bugs que nenhum teste de loader/action pegaria:
// o autosave nunca disparava (nada marcava "sujo"), a navegação olhava a resposta de
// QUALQUER save (inclusive de um anterior), e o envio para revisão ignorava o que estava
// digitado mas ainda não salvo.

const inicial = autosaveInicial(3)

/** Aplica uma sequência de eventos a partir do estado inicial. */
function aplicar(...eventos: Parameters<typeof autosaveReducer>[1][]): AutosaveState {
  return eventos.reduce(autosaveReducer, inicial)
}

describe('estado inicial', () => {
  it('nasce limpo, sem request em voo e com a revisão do loader', () => {
    expect(inicial.dirty).toBe(false)
    expect(inicial.pending).toBe(false)
    expect(inicial.revision).toBe(3)
    expect(inicial.blocked).toBe(false)
    expect(deveAutosalvar(inicial)).toBe(false)
  })
})

describe('o autosave precisa ser DISPARADO por edição', () => {
  it('sem edição não salva — este era o bug: nada marcava sujo', () => {
    expect(deveAutosalvar(inicial)).toBe(false)
  })

  it('editar marca sujo e habilita o autosave', () => {
    const estado = aplicar({ type: 'edited' })
    expect(estado.dirty).toBe(true)
    expect(deveAutosalvar(estado)).toBe(true)
  })

  it('não salva enquanto já há request em voo', () => {
    const estado = aplicar({ type: 'edited' }, { type: 'save-started', requestId: 1 })
    expect(estado.pending).toBe(true)
    expect(deveAutosalvar(estado)).toBe(false)
  })

  it('editar durante um save deixa sujo de novo, para salvar depois', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'edited' },
      { type: 'save-ok', requestId: 1, revision: 4 },
    )
    expect(estado.dirty).toBe(true)
    expect(deveAutosalvar(estado)).toBe(true)
  })

  it('salvar com sucesso limpa o sujo quando nada mudou no meio', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-ok', requestId: 1, revision: 4 },
    )
    expect(estado.dirty).toBe(false)
    expect(deveAutosalvar(estado)).toBe(false)
  })
})

describe('a revisão avança com a resposta do servidor', () => {
  it('usa a revisão devolvida, não a do loader', () => {
    // Mandar a do loader faria o segundo salvamento nascer desatualizado e levar 409
    // de si mesmo.
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-ok', requestId: 1, revision: 4 },
    )
    expect(estado.revision).toBe(4)
    expect(revisaoParaEnviar(estado)).toBe(4)
  })

  it('resposta de um save ANTIGO não mexe na revisão', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-started', requestId: 2 },
      { type: 'save-ok', requestId: 1, revision: 99 }, // chegou atrasada
    )
    expect(estado.revision).toBe(3)
    expect(estado.pending).toBe(true) // o request 2 ainda está em voo
  })
})

describe('conflito bloqueia — insistir sobrescreveria a outra aba', () => {
  it('conflito para de tentar salvar', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-conflict', requestId: 1 },
    )
    expect(estado.blocked).toBe(true)
    expect(deveAutosalvar(estado)).toBe(false)
  })

  it('editar depois do conflito NÃO volta a salvar', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-conflict', requestId: 1 },
      { type: 'edited' },
    )
    expect(deveAutosalvar(estado)).toBe(false)
  })

  it('conflito cancela navegação pendente — não avança em cima de erro', () => {
    const estado = aplicar(
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-conflict', requestId: 1 },
    )
    expect(navegacaoPendente(estado)).toBeNull()
  })

  it('falha comum não bloqueia, mas também não navega', () => {
    const estado = aplicar(
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-failed', requestId: 1 },
    )
    expect(estado.blocked).toBe(false)
    expect(navegacaoPendente(estado)).toBeNull()
  })
})

describe('navegação só depois do save DESTE clique', () => {
  it('pedir para navegar não navega na hora', () => {
    const estado = aplicar({ type: 'navigate-requested', step: 'servicos' })
    expect(navegacaoPendente(estado)).toBeNull()
    expect(estado.pending).toBe(false) // quem dispara o save é o componente
  })

  it('navega quando o save DESTE pedido confirma', () => {
    const estado = aplicar(
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-ok', requestId: 1, revision: 4 },
    )
    expect(navegacaoPendente(estado)).toBe('servicos')
  })

  it('NÃO navega com a resposta de um save anterior', () => {
    // O bug: `fetcher.data.ok` de um autosave antigo fazia a tela pular de etapa sem
    // que o save do clique tivesse terminado.
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-ok', requestId: 1, revision: 4 }, // resposta do autosave, não do clique
    )
    expect(navegacaoPendente(estado)).toBeNull()
  })

  it('navega só quando o save do clique (id maior) confirma', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-ok', requestId: 1, revision: 4 },
      { type: 'save-started', requestId: 2 },
      { type: 'save-ok', requestId: 2, revision: 5 },
    )
    expect(navegacaoPendente(estado)).toBe('servicos')
    expect(estado.revision).toBe(5)
  })

  it('depois de navegar, o destino é esquecido', () => {
    const estado = aplicar(
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-ok', requestId: 1, revision: 4 },
      { type: 'navigated' },
    )
    expect(navegacaoPendente(estado)).toBeNull()
  })
})

describe('toda navegação fica travada durante um request', () => {
  it('não deixa navegar com save em voo', () => {
    const estado = aplicar({ type: 'edited' }, { type: 'save-started', requestId: 1 })
    expect(podeNavegar(estado)).toBe(false)
  })

  it('libera quando o request termina', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-ok', requestId: 1, revision: 4 },
    )
    expect(podeNavegar(estado)).toBe(true)
  })

  it('um pedido de navegação enquanto outro está em voo é ignorado', () => {
    const estado = aplicar(
      { type: 'navigate-requested', step: 'servicos' },
      { type: 'save-started', requestId: 1 },
      { type: 'navigate-requested', step: 'seguranca' }, // clique duplo
    )
    expect(estado.navigateTo).toBe('servicos')
  })
})

describe('enviar para revisão salva o que está digitado antes', () => {
  it('pedir para enviar marca a intenção, não envia direto', () => {
    // O que está no textarea e ainda não foi salvo precisa entrar na versão que vai
    // para revisão — senão nossa equipe revisa uma resposta desatualizada.
    const estado = aplicar({ type: 'edited' }, { type: 'submit-requested' })
    expect(estado.submitAfterSave).toBe(true)
  })

  it('depois do save confirmar, o envio está liberado com a revisão nova', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'submit-requested' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-ok', requestId: 1, revision: 4 },
    )
    expect(estado.submitAfterSave).toBe(true)
    expect(revisaoParaEnviar(estado)).toBe(4)
  })

  it('conflito cancela o envio pendente', () => {
    const estado = aplicar(
      { type: 'edited' },
      { type: 'submit-requested' },
      { type: 'save-started', requestId: 1 },
      { type: 'save-conflict', requestId: 1 },
    )
    expect(estado.submitAfterSave).toBe(false)
  })

  it('sem edição pendente, enviar não precisa esperar save', () => {
    const estado = aplicar({ type: 'submit-requested' })
    expect(estado.submitAfterSave).toBe(true)
    expect(estado.dirty).toBe(false)
  })
})
