import { describe, expect, it } from 'vitest'
import { resolverAposPerderCas } from './claim'

// A decisão de "quem venceu a corrida" — testada como tabela, sem banco e sem gancho.
// A versão anterior disto era um `__setAntesDeTomarPonteiro` exportado pelo módulo de
// produção: estado global mutável para conseguir testar uma decisão que nem precisava de
// banco para ser decidida.

describe('resolverAposPerderCas', () => {
  it('review pendente: usa a versão de quem venceu', () => {
    expect(
      resolverAposPerderCas({ reviewVersionId: 'ver-do-vencedor', publishedVersionId: null }),
    ).toEqual({ tipo: 'usar-review', versionId: 'ver-do-vencedor' })
  })

  it('publicação venceu: não há rascunho a devolver', () => {
    // Publicar entre a leitura e o CAS muda o caso de "inicial" para "já tem configuração".
    // Abrir um rascunho aqui seria começar um segundo onboarding sem ninguém pedir.
    expect(
      resolverAposPerderCas({ reviewVersionId: null, publishedVersionId: 'ver-publicada' }),
    ).toEqual({ tipo: 'usar-publicada' })
  })

  it('com os dois preenchidos, a review manda', () => {
    // Configuração no ar + correção em elaboração: é a correção que a tela precisa mostrar.
    expect(
      resolverAposPerderCas({ reviewVersionId: 'ver-review', publishedVersionId: 'ver-antiga' }),
    ).toEqual({ tipo: 'usar-review', versionId: 'ver-review' })
  })

  it('nenhum dos dois: incoerente, e é para aparecer', () => {
    // O CAS exige os dois nulos. Perder com os dois ainda nulos significa que não foi
    // concorrência — chutar um rascunho aqui esconderia o problema de verdade.
    expect(resolverAposPerderCas({ reviewVersionId: null, publishedVersionId: null })).toEqual({
      tipo: 'incoerente',
    })
  })

  it('string vazia conta como ausente', () => {
    // Defensivo: um ponteiro vazio vindo de dado velho não pode virar `usar-review` com id
    // vazio, que produziria uma busca sem resultado e um erro de ponteiro órfão enganoso.
    expect(resolverAposPerderCas({ reviewVersionId: '', publishedVersionId: '' })).toEqual({
      tipo: 'incoerente',
    })
  })
})
