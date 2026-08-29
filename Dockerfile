# Evolution API 2.3.7 + patches Base Corretora — RECEITA DO LABORATÓRIO (branch lab)
#   - sincronização de leitura (igual à frota)
#   - nome de conta comercial (patch-baileys-nome.mjs — EM TESTE no lab)
#
# Espelho FIEL do Dockerfile oficial da tag 2.3.7 — a única diferença é o
# `git apply` do patch antes do build. Se o patch não aplicar limpo, o build
# FALHA (proposital: melhor não subir do que subir sem o patch).
#
# Por que existe: a Evolution 2.3.7 recebe do Baileys o app-state do WhatsApp
# (o mesmo canal que o WhatsApp Web usa para sincronizar "chat lido" entre
# aparelhos) e DESCARTA o dado antes de entregar no webhook. Ver README.md.
#
# Build:     docker build -t base-corretora/evolution-api:2.3.7-sync .
# Rollback:  voltar a imagem do serviço para evoapicloud/evolution-api:v2.3.7

FROM node:24-alpine AS builder

RUN apk update && \
    apk add --no-cache git ffmpeg wget curl bash openssl dos2unix

LABEL version="2.3.7-sync-nome-fwd-appstate-v2.1-lab" description="Evolution API 2.3.7 + patches Base Corretora (sync de leitura + nome comercial — LAB)"
LABEL maintainer="Base Corretora"

WORKDIR /evolution

# Fonte oficial, tag exata que já rodamos em produção
RUN git clone --depth 1 --branch 2.3.7 https://github.com/evolution-foundation/evolution-api.git .

# Patch da casa (4 arquivos, ~56 linhas)
COPY 2.3.7-sync-leitura.patch /tmp/basecorretora.patch
RUN git apply --verbose /tmp/basecorretora.patch

# Patch da etiqueta "Encaminhada" (EM TESTE no lab, 29/08): expõe `forwarded`
# nos envios (texto/mídia/áudio) → contextInfo.isForwarded no aparelho do
# destinatário. 2 arquivos, 14 linhas, nada de criptografia/sessão.
COPY 2.3.7-encaminhada.patch /tmp/basecorretora-encaminhada.patch
RUN git apply --verbose /tmp/basecorretora-encaminhada.patch

RUN npm ci --silent

# Patch da biblioteca Baileys (node_modules) — precisa vir DEPOIS do npm ci.
# SÓ o nome comercial (fix seguro, não toca em criptografia). As correções de
# app-state ficam FORA: derrubaram sessões da frota em 22-24/08.
COPY patch-baileys-nome.mjs /tmp/patch-baileys-nome.mjs
RUN node /tmp/patch-baileys-nome.mjs

# CAMPANHA 2 do lab (29/08): app-state — só os 2 fixes estilo rc14, com as
# validações de integridade INTACTAS (1b/1c derrubaram sessões da frota).
# Objetivo: "lido no Berê Zap" apagar o badge do celular. Dias de molho.
COPY patch-baileys-appstate.mjs /tmp/patch-baileys-appstate.mjs
RUN node /tmp/patch-baileys-appstate.mjs

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
