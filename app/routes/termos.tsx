import { Link } from 'react-router'
import {
  LegalDocument,
  LegalList,
  LegalSection,
  LegalValue,
} from '../components/legal/LegalDocument'
import { LEGAL_ENTITY, LEGAL_PRODUCT_NAME } from '../lib/legal'
import { TRIAL_DAYS } from '../lib/plans'

// Termos de Uso — página pública, exigida pelo Mercado Pago para homologar a conta e
// pelo CDC (o consumidor tem que saber quem é o fornecedor antes de contratar).
// A identificação do fornecedor vem toda de `app/lib/legal.ts`: é lá que se preenche.

export function meta() {
  return [
    { title: 'Termos de Uso — Hermes' },
    {
      name: 'description',
      content:
        'As regras de uso do Hermes: o que o serviço faz, o que é responsabilidade sua, planos, cancelamento e limites de responsabilidade.',
    },
  ]
}

export default function Termos() {
  return (
    <LegalDocument
      title="Termos de Uso"
      intro={`Estas são as regras do ${LEGAL_PRODUCT_NAME}. Escrevemos em português direto, sem juridiquês: o que entregamos, o que é responsabilidade sua e o que acontece quando algo dá errado. Ao criar uma conta, você aceita estes termos.`}
    >
      <LegalSection title="1. Quem oferece o serviço">
        <p>
          O {LEGAL_PRODUCT_NAME} é oferecido por <LegalValue value={LEGAL_ENTITY.nome} />, inscrita
          sob <LegalValue value={LEGAL_ENTITY.documento} />, com endereço em{' '}
          <LegalValue value={LEGAL_ENTITY.endereco} />. Contato oficial:{' '}
          <LegalValue value={LEGAL_ENTITY.email} />.
        </p>
        <p>
          Nestes termos, "nós" é quem está identificado acima e "você" é a pessoa ou empresa que
          contrata o serviço.
        </p>
      </LegalSection>

      <LegalSection title="2. O que o Hermes faz">
        <p>
          O {LEGAL_PRODUCT_NAME} é um atendente de WhatsApp com inteligência artificial. Depois de
          conectado ao seu número, ele:
        </p>
        <LegalList>
          <li>lê as mensagens que chegam e responde por escrito;</li>
          <li>responde seguindo as regras e a base de conhecimento que você escreve;</li>
          <li>registra cada conversa e monta uma ficha do contato;</li>
          <li>passa a conversa para uma pessoa da sua equipe quando o assunto sai do combinado.</li>
        </LegalList>
        <p>
          É um software por assinatura. Não somos uma central de atendimento: quem responde é o
          software, com as regras que você deu.
        </p>
      </LegalSection>

      <LegalSection title="3. Não somos o WhatsApp">
        <p>
          O {LEGAL_PRODUCT_NAME} não tem vínculo com o WhatsApp nem com a Meta, e não é aprovado,
          patrocinado ou endossado por eles. WhatsApp é marca da Meta. Ao usar o serviço, você
          continua sujeito às regras do WhatsApp, que podem mudar sem nos consultar.
        </p>
      </LegalSection>

      <LegalSection title="4. Sua conta">
        <LegalList>
          <li>O serviço é para uso profissional, por maiores de 18 anos.</li>
          <li>
            Informe dados verdadeiros e um e-mail que você acessa: avisos importantes e cobrança vão
            por ali.
          </li>
          <li>
            A senha é sua responsabilidade. O que for feito com o seu login é considerado feito por
            você. Se suspeitar de acesso indevido, avise pelo e-mail de contato e troque a senha.
          </li>
          <li>
            Você responde pelas pessoas da sua equipe a quem der acesso — inclusive pelo que elas
            fizerem no painel.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. A resposta é gerada por IA — e pode errar">
        <p>
          As respostas são geradas por um modelo de inteligência artificial. Isso muda o que você
          pode esperar:
        </p>
        <LegalList>
          <li>
            o modelo pode errar, entender mal a pergunta ou afirmar algo que não é verdade, mesmo
            bem configurado;
          </li>
          <li>a resposta não é revisada por uma pessoa antes de ser enviada;</li>
          <li>
            você deve revisar tudo que for crítico — preço, prazo, orientação de saúde, questão
            jurídica ou financeira, e qualquer coisa que vire compromisso;
          </li>
          <li>
            o atendente não substitui profissional habilitado (médico, advogado, contador). Não o
            configure para dar esse tipo de orientação sem revisão humana;
          </li>
          <li>você pode assumir a conversa a qualquer momento e desligar o atendente.</li>
        </LegalList>
        <p>
          Você conhece esse risco e aceita usar o serviço nessas condições. Na prática: configure a
          escalação para humano nos assuntos sensíveis do seu negócio.
        </p>
      </LegalSection>

      <LegalSection title="6. Avise que o atendimento é automatizado">
        <p>
          Deixe claro para quem escreve que ele está falando com um atendente automático que pode
          chamar uma pessoa. Não use o {LEGAL_PRODUCT_NAME} para fazer alguém acreditar que está
          conversando com uma pessoa específica.
        </p>
      </LegalSection>

      <LegalSection title="7. As conversas dos seus clientes são responsabilidade sua">
        <p>
          O {LEGAL_PRODUCT_NAME} trata mensagens de terceiros: os seus clientes. Ao usar o serviço,
          você declara que:
        </p>
        <LegalList>
          <li>
            tem base legal, na Lei Geral de Proteção de Dados, para tratar esses dados — incluindo
            registrar e guardar as conversas;
          </li>
          <li>
            informa seus clientes, quando exigido, que a conversa é registrada e processada por um
            sistema automatizado com IA;
          </li>
          <li>
            é o <strong className="font-medium text-ink">controlador</strong> desses dados; nós
            somos <strong className="font-medium text-ink">operador</strong> e tratamos apenas para
            prestar o serviço, conforme a Política de Privacidade;
          </li>
          <li>
            não vai colocar na base de conhecimento informação que você não pode compartilhar
            (sigilo profissional, cláusula de confidencialidade, segredo de terceiro);
          </li>
          <li>
            se o seu atendimento envolve dado sensível — saúde, por exemplo —, você tem base legal
            específica para tratá-lo.
          </li>
        </LegalList>
        <p>
          Se um cliente seu ou uma autoridade cobrar algo por causa desse tratamento, e a causa for
          o seu uso do serviço, a responsabilidade é sua.
        </p>
      </LegalSection>

      <LegalSection title="8. Uso aceitável — o que não pode">
        <LegalList>
          <li>
            disparo em massa, spam, lista comprada ou mensagem para quem não pediu para ser
            contatado;
          </li>
          <li>qualquer prática que viole os termos do WhatsApp ou da Meta;</li>
          <li>
            conteúdo ilegal, fraude, discriminação, assédio, ou se passar por outra pessoa ou
            empresa;
          </li>
          <li>revender ou repassar o acesso a terceiros sem combinar com a gente antes;</li>
          <li>
            tentar burlar limites técnicos, sobrecarregar o sistema, ou extrair o funcionamento por
            engenharia reversa;
          </li>
          <li>
            usar as respostas do atendente para decidir sozinho algo que afete direitos de alguém
            (crédito, contratação, atendimento de urgência) sem revisão humana.
          </li>
        </LegalList>
        <p>
          Identificado um uso assim, podemos suspender ou encerrar a conta — imediatamente, se
          houver risco para terceiros ou para o serviço.
        </p>
      </LegalSection>

      <LegalSection title="9. Conexão por QR code: o risco de bloqueio do número">
        <p>
          Dá para conectar o {LEGAL_PRODUCT_NAME} ao WhatsApp de dois jeitos: pela API oficial da
          Meta ou lendo o QR code do WhatsApp comum, como se fosse mais um aparelho conectado.
        </p>
        <p>
          A conexão por QR code{' '}
          <strong className="font-medium text-ink">não é a via oficial</strong> da Meta. Antes de
          ligar, entenda e aceite que:
        </p>
        <LegalList>
          <li>
            o WhatsApp pode limitar, bloquear ou banir o seu número, temporária ou definitivamente,
            sem aviso e sem nos consultar;
          </li>
          <li>
            o risco cresce muito com disparo em massa, volume alto para desconhecidos e denúncias de
            spam por quem recebe;
          </li>
          <li>
            a Meta pode mudar o aplicativo e derrubar a conexão a qualquer momento, exigindo
            reconectar;
          </li>
          <li>
            o número, a conta do WhatsApp e a reputação dele são seus. Não temos como reverter
            bloqueio nem falar com a Meta por você.
          </li>
        </LegalList>
        <p>
          Não respondemos por bloqueio, banimento, perda de acesso ao número ou perda do histórico
          do WhatsApp. Se o seu negócio não pode correr esse risco, use a API oficial.
        </p>
      </LegalSection>

      <LegalSection title="10. Planos, teste grátis e pagamento">
        <LegalList>
          <li>
            Os planos e preços em vigor estão na página inicial. São {TRIAL_DAYS} dias de teste
            grátis, sem cartão.
          </li>
          <li>
            Terminado o teste, o atendimento só continua se você assinar. O acesso ao histórico
            segue os prazos da seção 11.
          </li>
          <li>
            A assinatura é mensal e recorrente, cobrada pelo Mercado Pago. Os dados do seu cartão
            ficam com eles: não passam nem são guardados pelo {LEGAL_PRODUCT_NAME}.
          </li>
          <li>
            Preços em reais. Podemos reajustar avisando com pelo menos 30 dias de antecedência por
            e-mail; se não concordar, cancele antes de o novo valor valer.
          </li>
          <li>
            Se o pagamento falhar, avisamos e tentamos de novo. Persistindo, podemos suspender o
            atendimento até você regularizar.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="11. Cancelamento">
        <LegalList>
          <li>
            Cancele quando quiser, sem multa e sem fidelidade. Basta pedir pelo e-mail de contato:
            respondemos confirmando em até 2 dias úteis.
          </li>
          <li>
            O cancelamento vale para o ciclo seguinte: você usa até o fim do período já pago. Não
            devolvemos o mês em curso proporcionalmente, salvo quando a lei exigir.
          </li>
          <li>
            Arrependimento: se você contratou pela internet e é consumidor, pode desistir em até 7
            dias, com devolução do que pagou (art. 49 do Código de Defesa do Consumidor).
          </li>
          <li>
            Depois do cancelamento, os dados seguem os prazos da{' '}
            <Link to="/privacidade" className="text-brand underline">
              Política de Privacidade
            </Link>
            . Peça uma cópia antes, se quiser guardar o histórico.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="12. Disponibilidade, mudanças e suporte">
        <LegalList>
          <li>
            Trabalhamos para manter o serviço no ar, mas não prometemos 100%: há manutenção,
            instabilidade e falhas de terceiros (WhatsApp, provedor do modelo de IA, meio de
            pagamento, internet).
          </li>
          <li>
            Podemos mudar, melhorar ou descontinuar funcionalidades. Mudança que reduza de forma
            relevante o que você contratou é avisada com pelo menos 30 dias.
          </li>
          <li>
            Se encerrarmos o serviço inteiro, avisamos com pelo menos 30 dias, devolvemos a parte
            paga e não usada, e você pode pedir uma cópia dos seus dados.
          </li>
          <li>Suporte por e-mail, em dias úteis, conforme o plano contratado.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="13. Do que é de quem">
        <LegalList>
          <li>
            O software, o código e a marca {LEGAL_PRODUCT_NAME} são nossos. Você recebe uma licença
            de uso, não exclusiva e intransferível, enquanto a assinatura estiver ativa.
          </li>
          <li>
            O que é seu continua seu: a sua configuração, a sua base de conhecimento, os seus
            contatos e o conteúdo das conversas.
          </li>
          <li>
            Podemos usar dados agregados e anonimizados — que não identificam você nem seus clientes
            — para medir e melhorar o serviço.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="14. Limite da nossa responsabilidade">
        <p>Até o limite permitido pela lei brasileira:</p>
        <LegalList>
          <li>não respondemos por lucro cessante, perda de oportunidade ou dano indireto;</li>
          <li>
            não respondemos pelo conteúdo de uma resposta gerada pela IA que você não revisou, nem
            pela decisão que alguém tomou com base nela;
          </li>
          <li>
            não respondemos por bloqueio ou banimento de número pelo WhatsApp, nem pela
            indisponibilidade de serviços de terceiros;
          </li>
          <li>
            somadas todas as causas, nossa responsabilidade total fica limitada ao valor que você
            pagou pelo serviço nos 12 meses anteriores ao fato.
          </li>
        </LegalList>
        <p>
          Nada aqui afasta responsabilidade por dolo, nem os direitos que a lei — em especial o
          Código de Defesa do Consumidor — não permite limitar.
        </p>
      </LegalSection>

      <LegalSection title="15. Mudanças nestes termos">
        <p>
          Podemos atualizar estes termos. Mudança relevante é avisada por e-mail ou no painel com
          pelo menos 30 dias de antecedência. A data no topo mostra a última revisão. Se você
          continuar usando depois que a mudança valer, entendemos que aceitou; se não concordar,
          cancele.
        </p>
      </LegalSection>

      <LegalSection title="16. Lei aplicável e foro">
        <p>
          Estes termos seguem a lei brasileira. Qualquer problema, escreva primeiro para{' '}
          <LegalValue value={LEGAL_ENTITY.email} /> — quase tudo se resolve por ali. Não resolvendo,
          fica eleito o foro da comarca de <LegalValue value={LEGAL_ENTITY.foro} />. Se você for
          consumidor, pode acionar o foro do seu domicílio: este direito não é afastado.
        </p>
      </LegalSection>
    </LegalDocument>
  )
}
