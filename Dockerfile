# Evolution API 2.3.7 + patches Base Corretora
#   - sincronização de leitura (código da Evolution, via git apply)
#   - app-state + nome comercial (biblioteca Baileys, via patch-baileys.mjs)
#
# Espelho FIEL do Dockerfile oficial da tag 2.3.7 — as únicas diferenças são os
# dois passos de patch. Se qualquer um não aplicar limpo, o build FALHA
# (proposital: melhor não subir do que subir sem o patch).
#
# Por que existe, em duas camadas:
#   - Evolution: recebe do Baileys o app-state do WhatsApp (o canal que o
#     WhatsApp Web usa para sincronizar "chat lido" entre aparelhos) e DESCARTA
#     o dado antes de entregar no webhook.
#   - Baileys: manda os comandos de app-state com versão zerada, leva 409 do
#     WhatsApp dentro de um envelope "type=result" e reporta sucesso — e nunca
#     emite o nome de conta comercial. Ver README.md e patch-baileys.mjs.
#
# Build:     docker build -t base-corretora/evolution-api:2.3.7-sync2 .
# Rollback:  voltar a imagem do serviço para evoapicloud/evolution-api:v2.3.7

FROM node:24-alpine AS builder

RUN apk update && \
    apk add --no-cache git ffmpeg wget curl bash openssl dos2unix

LABEL version="2.3.7-sync2" description="Evolution API 2.3.7 + patches Base Corretora (sync de leitura + app-state + nome comercial)"
LABEL maintainer="Base Corretora"

WORKDIR /evolution

# Fonte oficial, tag exata que já rodamos em produção
RUN git clone --depth 1 --branch 2.3.7 https://github.com/evolution-foundation/evolution-api.git .

# Patch da casa (4 arquivos, ~56 linhas)
COPY 2.3.7-sync-leitura.patch /tmp/basecorretora.patch
RUN git apply --verbose /tmp/basecorretora.patch

RUN npm ci --silent

# Patch da biblioteca Baileys (node_modules) — precisa vir DEPOIS do npm ci.
# Conserta 3 defeitos que nenhum ajuste na Evolution alcança:
#   1+2. "marcar lido/nao lido" respondia sucesso e nao fazia nada no aparelho
#        (versao do app-state zerada -> WhatsApp devolve 409 dentro de um
#         "type=result" -> o Baileys reporta sucesso). Issue #1406.
#   3.   nome de conta COMERCIAL nunca chegava (contato exibido como numero).
# O script FALHA o build se qualquer alvo nao casar exatamente.
COPY patch-baileys.mjs /tmp/patch-baileys.mjs
RUN node /tmp/patch-baileys.mjs

RUN cp ./.env.example ./.env

RUN chmod +x ./Docker/scripts/* && dos2unix ./Docker/scripts/*

RUN ./Docker/scripts/generate_database.sh

RUN npm run build

FROM node:24-alpine AS final

RUN apk update && \
    apk add tzdata ffmpeg bash openssl

ENV TZ=America/Sao_Paulo
ENV DOCKER_ENV=true

WORKDIR /evolution

COPY --from=builder /evolution/package.json ./package.json
COPY --from=builder /evolution/package-lock.json ./package-lock.json

COPY --from=builder /evolution/node_modules ./node_modules
COPY --from=builder /evolution/dist ./dist
COPY --from=builder /evolution/prisma ./prisma
COPY --from=builder /evolution/manager ./manager
COPY --from=builder /evolution/public ./public
COPY --from=builder /evolution/.env ./.env
COPY --from=builder /evolution/Docker ./Docker
COPY --from=builder /evolution/runWithProvider.js ./runWithProvider.js
COPY --from=builder /evolution/tsup.config.ts ./tsup.config.ts

ENV DOCKER_ENV=true

EXPOSE 8080

ENTRYPOINT ["/bin/bash", "-c", ". ./Docker/scripts/deploy_database.sh && npm run start:prod" ]
