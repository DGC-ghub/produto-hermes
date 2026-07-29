import {
  LegalDocument,
  LegalList,
  LegalSection,
  LegalValue,
} from '../components/legal/LegalDocument'
import {
  LEGAL_DELETION_GRACE_DAYS,
  LEGAL_ENTITY,
  LEGAL_PRODUCT_NAME,
  LEGAL_REQUEST_ANSWER_DAYS,
} from '../lib/legal'

// Política de Privacidade — exigência da LGPD e do Mercado Pago. O ponto delicado do
// Hermes está na seção 2: o conteúdo das conversas é de TERCEIROS (os clientes do
// cliente), então quem contrata é o controlador e nós somos o operador.
// Identificação do fornecedor e prazos vêm de `app/lib/legal.ts`.

export function meta() {
  return [
    { title: 'Política de Privacidade — Hermes' },
    {
      name: 'description',
      content:
        'Quais dados o Hermes trata, para quê, com quem compartilha, por quanto tempo guarda e como pedir cópia ou exclusão.',
    },
  ]
}

export default function Privacidade() {
  return (
    <LegalDocument
      title="Política de Privacidade"
      intro={`Aqui explicamos quais dados o ${LEGAL_PRODUCT_NAME} trata, por que trata, com quem compartilha e como pedir para ver ou apagar. Vale tanto para quem contrata o serviço quanto para quem conversa com um WhatsApp atendido por ele.`}
    >
      <LegalSection title="1. Em resumo">
        <LegalList>
          <li>
            Sobre os dados da conta da sua empresa (nome, e-mail, assinatura), nós somos o
            controlador.
          </li>
          <li>
            Sobre o conteúdo das conversas com os <em>seus</em> clientes, você é o controlador e nós
            somos o operador: tratamos por sua conta e ordem.
          </li>
          <li>
            O conteúdo das mensagens vai para um provedor de modelo de IA, só para gerar a resposta.
          </li>
          <li>Não vendemos dados e não usamos essas conversas para treinar modelos de IA.</li>
          <li>
            Cópia ou exclusão dos dados: peça a qualquer momento por{' '}
            <LegalValue value={LEGAL_ENTITY.emailEncarregado} />.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="2. Quem é controlador e quem é operador">
        <p>
          A LGPD separa dois papéis. O <strong className="font-medium text-ink">controlador</strong>{' '}
          decide por que e como os dados são tratados. O{' '}
          <strong className="font-medium text-ink">operador</strong> trata os dados em nome do
          controlador. No {LEGAL_PRODUCT_NAME} o papel muda conforme o dado:
        </p>
        <LegalList>
          <li>
            <strong className="font-medium text-ink">Dados da sua conta e da assinatura:</strong>{' '}
            nós somos o controlador.
          </li>
          <li>
            <strong className="font-medium text-ink">
              Conteúdo das conversas entre o seu WhatsApp e os seus clientes:
            </strong>{' '}
            você é o controlador, nós somos o operador. Você decide o que o atendente pergunta e o
            que fica registrado; nós tratamos apenas para prestar o serviço.
          </li>
        </LegalList>
        <p>
          Na prática: se um cliente seu quiser ver ou apagar o que conversou, o pedido é para você.
          Se chegar direto para nós, encaminhamos para você em vez de decidir por conta própria.
        </p>
      </LegalSection>

      <LegalSection title="3. Que dados tratamos">
        <p>
          <strong className="font-medium text-ink">Da sua conta:</strong>
        </p>
        <LegalList>
          <li>nome, e-mail e senha (guardada como hash, nunca em texto);</li>
          <li>
            os dados da empresa que você preencher e as regras e a base de conhecimento que você
            escrever;
          </li>
          <li>
            situação da assinatura (plano, status, datas). Os dados do cartão vão direto para o
            Mercado Pago: não passam pelo {LEGAL_PRODUCT_NAME} nem ficam nos nossos servidores.
          </li>
        </LegalList>
        <p>
          <strong className="font-medium text-ink">Das conversas com os seus clientes:</strong>
        </p>
        <LegalList>
          <li>número de WhatsApp e nome de exibição de quem escreve;</li>
          <li>
            o conteúdo das mensagens trocadas, em texto; quando vem áudio, o texto da transcrição;
          </li>
          <li>
            o que o atendente registrar sobre o contato: ficha, chamados abertos, marcação de
            interesse e o momento em que a conversa passou para uma pessoa;
          </li>
          <li>data e hora de cada mensagem.</li>
        </LegalList>
        <p>
          <strong className="font-medium text-ink">Técnicos:</strong>
        </p>
        <LegalList>
          <li>registros de acesso e de erro (data, hora, ação e identificador da conta);</li>
          <li>
            um cookie de sessão, necessário para manter você logado. Não usamos cookie de
            publicidade nem rastreadores de terceiros.
          </li>
        </LegalList>
        <p>
          Atenção: o conteúdo da mensagem é escrito pelo seu cliente e pode conter qualquer coisa,
          inclusive dado sensível — de saúde, por exemplo. Nós não pedimos esse tipo de dado.
          Configure o atendente para não perguntar o que o seu negócio não precisa saber.
        </p>
      </LegalSection>

      <LegalSection title="4. Para que usamos">
        <LegalList>
          <li>fazer o atendente funcionar: entender a mensagem recebida e gerar a resposta;</li>
          <li>
            manter o histórico e a ficha do contato, para a conversa não recomeçar do zero a cada
            mensagem;
          </li>
          <li>avisar você e passar a conversa para uma pessoa quando for o caso;</li>
          <li>cobrar a assinatura e emitir o que a lei exigir;</li>
          <li>dar suporte quando você pedir;</li>
          <li>segurança: prevenir abuso, fraude e uso indevido do serviço;</li>
          <li>melhorar o serviço, com números agregados que não identificam ninguém.</li>
        </LegalList>
        <p>
          Não vendemos dado pessoal, não usamos o conteúdo das conversas para publicidade e não
          usamos as conversas dos seus clientes para treinar modelos de IA.
        </p>
      </LegalSection>

      <LegalSection title="5. Os dados vão para um modelo de IA">
        <p>
          Para escrever cada resposta, o {LEGAL_PRODUCT_NAME} envia ao provedor do modelo de IA: a
          mensagem recebida, um trecho recente da conversa, a ficha do contato e as regras e a base
          de conhecimento da sua empresa. O provedor devolve a proposta de resposta, que o sistema
          valida antes de enviar.
        </p>
        <LegalList>
          <li>
            Hoje o provedor é a Anthropic (modelos Claude). O processamento acontece em servidores
            fora do Brasil, o que caracteriza transferência internacional de dados (art. 33 da
            LGPD). Ela é necessária para executar o contrato com você.
          </li>
          <li>
            O uso do conteúdo pelo provedor segue os termos do plano que contratamos com ele. Não
            enviamos as conversas para nenhum outro destino além do necessário para gerar a
            resposta.
          </li>
          <li>
            Quando o cliente manda áudio, a transcrição é feita no nosso próprio servidor: o áudio
            não vai para serviço externo de transcrição. O texto transcrito segue o mesmo caminho de
            uma mensagem escrita.
          </li>
          <li>Se trocarmos de provedor, atualizamos esta página.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="6. Com quem compartilhamos">
        <p>Só com quem é necessário para o serviço funcionar:</p>
        <LegalList>
          <li>Anthropic — gerar a resposta do atendente (Estados Unidos);</li>
          <li>Mercado Pago — cobrança da assinatura (Brasil);</li>
          <li>
            Resend — envio dos e-mails do sistema, como verificação de conta e redefinição de senha
            (Estados Unidos);
          </li>
          <li>
            a infraestrutura onde o sistema roda: <LegalValue value={LEGAL_ENTITY.hospedagem} />.
          </li>
        </LegalList>
        <p>
          Também compartilhamos quando a lei ou uma ordem judicial exigir, e para defender nossos
          direitos em processo. Fora isso, não repassamos dados a ninguém. Se essa lista mudar,
          atualizamos esta página.
        </p>
      </LegalSection>

      <LegalSection title="7. Com que base legal">
        <LegalList>
          <li>
            execução do contrato (art. 7º, V) — criar a conta, prestar o atendimento e cobrar;
          </li>
          <li>
            cumprimento de obrigação legal (art. 7º, II) — guarda fiscal e de registros de acesso;
          </li>
          <li>
            legítimo interesse (art. 7º, IX) — segurança, prevenção a fraude e melhoria do serviço
            com dados agregados;
          </li>
          <li>
            para o conteúdo das conversas com os seus clientes, quem define e responde pela base
            legal é você, como controlador. Nós tratamos como operador.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="8. Por quanto tempo guardamos">
        <LegalList>
          <li>Enquanto a conta existir, guardamos os dados para o serviço funcionar.</li>
          <li>
            Depois do cancelamento, mantemos por até {LEGAL_DELETION_GRACE_DAYS} dias, para você
            reativar ou pedir uma cópia. Passado esse prazo, apagamos as conversas, os contatos e a
            base de conhecimento.
          </li>
          <li>
            Se pedir a exclusão antes disso, apagamos em até {LEGAL_REQUEST_ANSWER_DAYS} dias —
            exceto o que a lei manda guardar.
          </li>
          <li>Dados de pagamento e documentos fiscais ficam pelo prazo legal, em regra 5 anos.</li>
          <li>
            Registros de acesso ficam por pelo menos 6 meses (Marco Civil da Internet, art. 15).
          </li>
        </LegalList>
        <p>
          As cópias de segurança são apagadas no ciclo normal de rotação, o que pode levar alguns
          dias a mais que o prazo acima.
        </p>
      </LegalSection>

      <LegalSection title="9. Segurança">
        <LegalList>
          <li>senhas guardadas como hash, nunca em texto;</li>
          <li>
            segredos sensíveis — como a credencial que conecta o seu WhatsApp — são cifrados quando
            guardados (AES-256-GCM), e o segredo de uma conta não pode ser lido no contexto de
            outra;
          </li>
          <li>o painel exige login, e as telas internas exigem sessão válida;</li>
          <li>o tráfego entre o seu navegador e o sistema é cifrado (HTTPS);</li>
          <li>o acesso administrativo é restrito a quem precisa dele para operar o serviço.</li>
        </LegalList>
        <p>
          Nenhum sistema é 100% seguro. Se houver um incidente com risco relevante, comunicamos você
          e a ANPD nos prazos da lei, dizendo o que aconteceu e o que fazer.
        </p>
      </LegalSection>

      <LegalSection title="10. Seus direitos">
        <p>A LGPD (art. 18) garante a você:</p>
        <LegalList>
          <li>saber se tratamos dados seus e ter acesso a eles;</li>
          <li>corrigir dado incompleto, inexato ou desatualizado;</li>
          <li>pedir anonimização, bloqueio ou eliminação de dado desnecessário ou excessivo;</li>
          <li>pedir a portabilidade para outro fornecedor;</li>
          <li>saber com quem compartilhamos seus dados;</li>
          <li>revogar o consentimento, quando o tratamento se apoiar nele;</li>
          <li>pedir revisão de decisão tomada só por sistema automatizado.</li>
        </LegalList>
        <p>
          Para exercer qualquer um deles, escreva para{' '}
          <LegalValue value={LEGAL_ENTITY.emailEncarregado} />. Respondemos em até{' '}
          {LEGAL_REQUEST_ANSWER_DAYS} dias. Podemos pedir informações para confirmar sua identidade
          — é proteção contra alguém pedir os seus dados se passando por você.
        </p>
      </LegalSection>

      <LegalSection title="11. Se você conversou com uma empresa que usa o Hermes">
        <p>
          Você mandou mensagem no WhatsApp de uma empresa e chegou até aqui. O que precisa saber:
        </p>
        <LegalList>
          <li>quem decide o que fazer com aquela conversa é a empresa com quem você falou;</li>
          <li>nós só operamos o sistema que ela usa para atender;</li>
          <li>para ver, corrigir ou apagar o que foi conversado, procure essa empresa;</li>
          <li>
            se preferir escrever para nós, em <LegalValue value={LEGAL_ENTITY.emailEncarregado} />,
            encaminhamos o pedido para ela e ajudamos no que der.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="12. Crianças e adolescentes">
        <p>
          O {LEGAL_PRODUCT_NAME} é uma ferramenta de trabalho, feita para empresas. Não é
          direcionado a menores de 18 anos e não coletamos dados de crianças e adolescentes de
          propósito. Se identificarmos um cadastro assim, apagamos.
        </p>
      </LegalSection>

      <LegalSection title="13. Encarregado de dados">
        <p>
          Encarregado (DPO): <LegalValue value={LEGAL_ENTITY.encarregado} />. E-mail:{' '}
          <LegalValue value={LEGAL_ENTITY.emailEncarregado} />. Ele é o canal entre você, nós e a
          ANPD.
        </p>
        <p>
          Responsável pelo tratamento: <LegalValue value={LEGAL_ENTITY.nome} />,{' '}
          <LegalValue value={LEGAL_ENTITY.documento} />,{' '}
          <LegalValue value={LEGAL_ENTITY.endereco} />.
        </p>
      </LegalSection>

      <LegalSection title="14. Mudanças nesta política">
        <p>
          Podemos atualizar esta política. A data da última atualização fica no topo da página.
          Mudança relevante é avisada por e-mail ou no painel. Se ela afetar o tratamento das
          conversas dos seus clientes, avisamos com antecedência para você poder se ajustar.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
