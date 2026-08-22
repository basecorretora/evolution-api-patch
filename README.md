# Patch da Evolution API — sincronização de leitura (Berê Zap)

**Status:** patch pronto e revisável; **deploy pendente** (precisa build + troca de imagem no EasyPanel).
**Descoberto em:** 21/08/2026, teste de campo do Junior (celular × Berê Zap).

---

## O problema, em uma frase

O Berê Zap nunca conseguiu espelhar o "não lido" do celular **não por limitação do WhatsApp, mas porque a Evolution API descarta o dado no meio do caminho**.

## A prova

**1. O WhatsApp manda.** O canal multi-device (o mesmo que o WhatsApp Web usa) envia uma mutação de app-state quando você lê um chat em outro aparelho. O Baileys processa e emite o evento com o dado — `Baileys/src/Utils/chat-utils.ts`:

```ts
} else if (action?.markChatAsReadAction) {
  const markReadAction = action.markChatAsReadAction
  ev.emit('chats.update', [{
    id,
    unreadCount: isNullUpdate ? null : !!markReadAction?.read ? 0 : -1,   // 0 = LIDO
    conditional: getChatUpdateConditional(id!, markReadAction?.messageRange)
  }])
```

**2. A Evolution joga fora.** `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:784` (tag 2.3.7):

```ts
'chats.update': async (chats) => {
  const chatsRaw = chats.map((chat) => {
    return { remoteJid: chat.id, instanceId: this.instanceId };   // ← descarta unreadCount
  });
  this.sendDataWebhook(Events.CHATS_UPDATE, chatsRaw);

  for (const chat of chats) {
    await this.prismaRepository.chat.updateMany({
      where: { instanceId: this.instanceId, remoteJid: chat.id, name: chat.name },
      data: { remoteJid: chat.id },     // ← nem persiste no banco dela
    });
  }
}
```

**3. A evidência em produção.** Nos logs do nosso webhook, **~10.835 vezes por dia**:

```
[CHATS-READ] Sem sinal de leitura — keys: ["remoteJid","instanceId"] chatJid=...
```

São os avisos de leitura chegando esvaziados.

**4. A volta (Berê Zap → celular) também já existe, travada.** `whatsapp.baileys.service.ts:3760`:

```ts
await this.client.chatModify({ markRead: false, lastMessages: [last_message] }, createJid(number));
//                                       ^^^^^ hardcoded — só expõe "marcar como NÃO lido"
```

---

## O que o patch faz (4 arquivos, ~56 linhas)

| Arquivo | Mudança |
|---|---|
| `whatsapp.baileys.service.ts` (`chats.update`) | Repassa `unreadCount`, `archived`, `pinned`, `muteEndTime`, `markedAsUnread` no webhook **e persiste** `unreadMessages` em `Chat` |
| `whatsapp.baileys.service.ts` (`markChatUnread`) | Honra `data.read` → `chatModify({ markRead: true })` e zera o contador local |
| `chat.dto.ts` | Campo opcional `read?: boolean` |
| `chat.schema.ts` | Aceita `read` na validação |
| `chat.router.ts` | Rota nova `POST /chat/markChatRead/{instance}` |

Nenhum comportamento existente muda: sem `read`, tudo se comporta como antes.

## Efeito esperado

- **Celular/WhatsApp Web → Berê Zap:** ler lá apaga o badge aqui (o handler do nosso webhook já procura `unreadCount === 0` desde a Etapa 4 da auditoria).
- **Berê Zap → celular:** abrir a conversa aqui apaga o badge lá (via `markChatRead`) — resolve a limitação registrada em `project_chats_read_sync` desde março.
- De brinde: arquivar/fixar/silenciar passam a poder ser sincronizados.

---

## Deploy

```bash
# na pasta docs/evolution-patch
docker build -t base-corretora/evolution-api:2.3.7-sync .
```

Depois, no EasyPanel → projeto `base_corretora` → serviço `evolution-api` → trocar a imagem
`evoapicloud/evolution-api:v2.3.7` pela imagem construída e redeployar.

**Rollback (1 passo):** voltar a imagem para `evoapicloud/evolution-api:v2.3.7`. O patch não altera schema de banco — nada a desfazer no Postgres da Evolution.

## Teste de aceite (fazer com 1 número antes de considerar pronto)

1. Mandar mensagem para um número conectado → badge aparece no Berê Zap.
2. Ler no **celular** → badge some no Berê Zap em segundos.
   Log esperado: `[CHATS-READ] Sinal de leitura detectado: ... unreadCount=0` (hoje aparece "Sem sinal de leitura").
3. Mandar outra mensagem, ler **no Berê Zap** → badge some no celular.
4. Conferir que envio/recebimento seguem normais (o patch não toca no fluxo de mensagens).

## Manutenção

Reaplicar o patch a cada upgrade da Evolution (`git apply 2.3.7-sync-leitura.patch`; se conflitar, o bloco-alvo é pequeno e fácil de reescrever). Vale propor upstream — o comportamento atual é claramente uma perda de dado não intencional.
