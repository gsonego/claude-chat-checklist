# chat-checklist

Um mod para o Claude Code que mostra, num painel lateral, o estado do que está sendo feito **em cada chat**: o que é preciso fazer, o que depende de você e o que ficou decidido. Assim você não precisa rolar a conversa para descobrir o que falta.

## O que o painel mostra

- **Pendências**: o que só você pode fazer ou decidir. Um ✕ ao lado de cada item permite baixar a pendência. As resolvidas ficam recolhidas numa linha ("▸ 4 pendência(s) resolvida(s)") que você clica para ver quais foram.
- **Checklist**: os passos do trabalho, com barra de progresso. Feito (✓), em andamento (▶) e a fazer (○).
- **Decisões**: o que foi combinado no chat. Fica oculta por padrão; o botão "Decisões" a mostra.

Cada chat tem a sua própria lista, sem misturar com outros chats do mesmo projeto, e a lista volta quando você retoma o chat. O Claude mantém a lista por uma ferramenta própria do mod, conforme o trabalho avança; o painel é só de leitura (exceto o ✕).

Quando surge uma pendência nova, o mod mostra um toast e uma notificação. O botão "Avisos" no painel liga e desliga isso.

## Instalação

No terminal, dentro do Claude Code:

```
/plugin install chat-checklist --marketplace gsonego/claude-chat-checklist
```

De um shell:

```
claude plugin install chat-checklist --marketplace gsonego/claude-chat-checklist
```

No app desktop, onde `/plugin` não roda: clique em **+** ao lado do campo de digitação, depois **Plugins**, **Add marketplace** com `gsonego/claude-chat-checklist` e **Add plugin**.

## Uso

- O painel abre sozinho quando o primeiro item aparece num chat.
- `/checklist` abre e fecha o painel. Se você o fechar, ele não reabre sozinho naquele chat.
- Não é preciso pedir nada: o Claude passa a manter o painel quando o trabalho tem mais de um passo.

## Limites

- Testado no app desktop. No terminal o painel usa os mesmos elementos, mas não foi testado lá; em telas estreitas ele só abre com `/checklist`.
- Não toca som: o motor não tem player de áudio no Windows. Toast e notificação funcionam.
- A lista só existe se o Claude usar a ferramenta do mod. Ela é incentivada por uma instrução adicionada ao prompt do sistema, que não roda em instalações sob gestão de uma organização.

## Desenvolvimento

```
claude plugin validate .
claude plugin test .
```

O código está em `hooks/register.tsx`, o contrato do estado em `types/index.d.ts`. A API de mods do Claude Code ainda é de acesso antecipado e pode mudar entre versões.

## Licença

MIT
