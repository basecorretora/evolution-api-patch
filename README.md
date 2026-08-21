# Evolution API 2.3.7 + patch de sincronização de leitura

Patch da **Base Corretora** sobre a [Evolution API](https://github.com/evolution-foundation/evolution-api) 2.3.7.

## O problema

A Evolution recebe do Baileys o *app-state* do WhatsApp (o mesmo canal multi-device que o WhatsApp Web usa para sincronizar "chat lido" entre aparelhos), mas **descarta o dado** antes de entregá-lo no webhook.

**Baileys** (`src/Utils/chat-utils.ts`) — o sinal existe:

```ts
} else if (action?.markChatAsReadAction) {
  const markReadAction = action.markChatAsReadAction
  ev.emit('chats.update', [{
    id,
    unreadCount: isNullUpdate ? null : !!markReadAction?.read ? 0 : -1,   // 0 = LIDO
    conditional: getChatUpdateConditional(id!, markReadAction?.messageRange)
  }])
```

**Evolution 2.3.7** (`whatsapp.baileys.service.ts:784`) — o sinal morre:

```ts
'chats.update': async (chats) => {
  const chatsRaw = chats.map((chat) => {
    return { remoteJid: chat.id, instanceId: this.instanceId };   // descarta unreadCount
  });
  this.sendDataWebhook(Events.CHATS_UPDATE, chatsRaw);

  for (const chat of chats) {
    await this.prismaRepository.chat.updateMany({
      where: { instanceId: this.instanceId, remoteJid: chat.id, name: chat.name },
      data: { remoteJid: chat.id },     // nem persiste unreadMessages
    });
  }
}
```

Em produção isso rendia ~10.800 eventos por dia chegando com apenas `{remoteJid, instanceId}` — avisos de leitura esvaziados.

E a direção inversa já existia, travada (`:3760`):

```ts
await this.client.chatModify({ markRead: false, lastMessages: [last_message] }, createJid(number));
//                                       ^^^^^ hardcoded: só expõe "marcar como NÃO lido"
```

## O que o patch faz

| Arquivo | Mudança |
|---|---|
| `whatsapp.baileys.service.ts` (`chats.update`) | Repassa `unreadCount`, `archived`, `pinned`, `muteEndTime`, `markedAsUnread` no webhook **e persiste** `unreadMessages` |
| `whatsapp.baileys.service.ts` (`markChatUnread`) | Honra `data.read` → `chatModify({ markRead: true })` e zera o contador local |
| `chat.dto.ts` / `chat.schema.ts` | Campo opcional `read?: boolean` |
| `chat.router.ts` | Rota nova `POST /chat/markChatRead/{instance}` |

Sem `read`, todo comportamento existente permanece idêntico.

## Build

```bash
docker build -t base-corretora/evolution-api:2.3.7-sync .
```

O Dockerfile clona a tag oficial 2.3.7, aplica o patch (falha o build se não aplicar limpo) e compila — espelho fiel do Dockerfile oficial, sem outras mudanças.

## Rollback

Voltar a imagem do serviço para `evoapicloud/evolution-api:v2.3.7`. O patch não altera schema de banco.

## Licença

O código da Evolution API segue a licença do projeto original. Este repositório contém apenas o patch e o Dockerfile de build.
