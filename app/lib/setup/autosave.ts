import type { SetupStep } from './answers'

// Máquina do autosave da tela de onboarding. PURA: sem React, sem rede.
//
// Está aqui, e não dentro do componente, porque é LÓGICA — e porque a primeira versão
// tinha três defeitos que nenhum teste de loader/action pegaria:
//  1. o autosave nunca disparava (nada marcava "sujo");
//  2. a navegação reagia à resposta de QUALQUER save, inclusive de um anterior, e a tela
//     pulava de etapa antes de o save do clique terminar;
//  3. "enviar para revisão" ignorava o que estava digitado e ainda não salvo — nossa
//     equipe revisaria uma resposta desatualizada.
//
// Cada request tem um `requestId` crescente. A navegação e o envio guardam a partir de
// QUAL request valem: é isso que impede a resposta de um autosave antigo de liberar uma
// ação que dependia do save do clique.

export type AutosaveState = {
  /** Há edição ainda não enviada ao servidor. */
  dirty: boolean
  /** Há um request em voo. */
  pending: boolean
  /** Qual request está em voo (0 = nenhum). */
  inFlightId: number
  /** Para onde ir quando o save correspondente confirmar. */
  navigateTo: SetupStep | null
  /** Menor `requestId` que serve para liberar a navegação. */
  navigateAfterId: number
  /** Enviar para revisão quando o save correspondente confirmar. */
  submitAfterSave: boolean
  /** Menor `requestId` que serve para liberar o envio. */
  submitAfterId: number
  /** Maior `requestId` que já confirmou com sucesso. */
  lastConfirmedId: number
  /** Revisão a mandar no próximo POST — vem do servidor, não do loader. */
  revision: number
  /** Conflito: parar de tentar. Insistir sobrescreveria o que a outra aba gravou. */
  blocked: boolean
}

export type AutosaveEvent =
  | { type: 'edited' }
  | { type: 'save-started'; requestId: number }
  | { type: 'save-ok'; requestId: number; revision: number }
  | { type: 'save-conflict'; requestId: number }
  | { type: 'save-failed'; requestId: number }
  | { type: 'navigate-requested'; step: SetupStep }
  | { type: 'submit-requested' }
  | { type: 'navigated' }
  | { type: 'submitted' }

export function autosaveInicial(revision: number): AutosaveState {
  return {
    dirty: false,
    pending: false,
    inFlightId: 0,
    navigateTo: null,
    navigateAfterId: 0,
    submitAfterSave: false,
    submitAfterId: 0,
    lastConfirmedId: 0,
    revision,
    blocked: false,
  }
}

/** A resposta é do request que está em voo? Se não, chegou atrasada e deve ser ignorada. */
function ehDoRequestEmVoo(state: AutosaveState, requestId: number): boolean {
  return state.inFlightId === requestId
}

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event.type) {
    case 'edited':
      return { ...state, dirty: true }

    case 'save-started':
      // O conteúdo foi enviado: `dirty` zera aqui. Se a pessoa digitar durante o voo, o
      // evento `edited` marca de novo e um segundo save sai depois.
      return { ...state, pending: true, inFlightId: event.requestId, dirty: false }

    case 'save-ok':
      if (!ehDoRequestEmVoo(state, event.requestId)) {
        return state
      }
      return {
        ...state,
        pending: false,
        inFlightId: 0,
        lastConfirmedId: Math.max(state.lastConfirmedId, event.requestId),
        revision: event.revision,
      }

    case 'save-conflict':
      if (!ehDoRequestEmVoo(state, event.requestId)) {
        return state
      }
      // Conflito cancela tudo o que dependia deste save: navegar ou enviar em cima de uma
      // recusa levaria a pessoa adiante achando que deu certo.
      return {
        ...state,
        pending: false,
        inFlightId: 0,
        blocked: true,
        navigateTo: null,
        submitAfterSave: false,
      }

    case 'save-failed':
      if (!ehDoRequestEmVoo(state, event.requestId)) {
        return state
      }
      return { ...state, pending: false, inFlightId: 0, navigateTo: null, submitAfterSave: false }

    case 'navigate-requested':
      // Clique duplo: o primeiro destino manda. E a navegação passa a valer só a partir
      // do PRÓXIMO request — a resposta de um save já em voo não serve, porque não
      // carrega o que a pessoa acabou de digitar.
      return state.navigateTo
        ? state
        : { ...state, navigateTo: event.step, navigateAfterId: state.inFlightId + 1 }

    case 'submit-requested':
      return { ...state, submitAfterSave: true, submitAfterId: state.inFlightId + 1 }

    case 'navigated':
      return { ...state, navigateTo: null, navigateAfterId: 0 }

    case 'submitted':
      return { ...state, submitAfterSave: false, submitAfterId: 0 }
  }
}

/** Deve disparar um autosave agora? */
export function deveAutosalvar(state: AutosaveState): boolean {
  return state.dirty && !state.pending && !state.blocked
}

/**
 * Para onde navegar agora. Só devolve o destino quando um save de id suficiente já
 * confirmou — a resposta de um autosave anterior não libera a troca de etapa.
 */
export function navegacaoPendente(state: AutosaveState): SetupStep | null {
  if (state.pending || !state.navigateTo) {
    return null
  }
  // `inFlightId` zera ao confirmar; `revision` avançou. O critério é ter passado por um
  // save que começou depois do pedido — rastreado por `navigateAfterId`.
  return state.navigateAfterId <= state.lastConfirmedId ? state.navigateTo : null
}

/** Navegação é permitida? Trava durante qualquer request em voo. */
export function podeNavegar(state: AutosaveState): boolean {
  return !state.pending
}

/** O envio para revisão já pode acontecer (o save que o precede confirmou)? */
export function envioLiberado(state: AutosaveState): boolean {
  return state.submitAfterSave && !state.pending && state.submitAfterId <= state.lastConfirmedId
}

/** A revisão que deve ir no POST de envio — sempre a mais recente conhecida. */
export function revisaoParaEnviar(state: AutosaveState): number {
  return state.revision
}
