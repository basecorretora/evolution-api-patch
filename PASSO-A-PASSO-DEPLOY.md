# Passo a passo — deploy do patch da Evolution (sincronização de leitura)

Escrito para a VPS `base-vps.basecorretora.com.br` (Ubuntu 24.04 + EasyPanel), a partir do painel da Hostinger.

**Tempo:** ~15 min (a maior parte é o build rodando sozinho).
**Impacto:** ao trocar a imagem, a Evolution reinicia. As instâncias reconectam sozinhas em 1–2 min — **ninguém precisa ler QR Code de novo** (as sessões ficam no banco, que o patch não toca).
**Rollback:** 1 campo, ~1 min (ETAPA 7).

---

## ETAPA 1 — Abrir o terminal do servidor

No painel da Hostinger (a tela do print), no bloco **Ubuntu 24.04 · Em Atividade**:

➡️ clicar em **`Web console`** (botão à direita, ao lado de "Reiniciar")

Abre um terminal preto já logado como `root`. É nele que vão os comandos das etapas 2 e 3.

> Se pedir senha: é a senha root da VPS. Esqueceu? No mesmo painel tem **"Esqueceu a senha root? Redefinir senha"**.

---

## ETAPA 2 — Confirmar o terreno (antes de mudar qualquer coisa)

Cole este bloco inteiro e aperte Enter:

```bash
docker service ls --format '{{.Name}}\t{{.Image}}' | grep -i evolution
```

**O que deve aparecer** (uma linha parecida com):

```
base_corretora_evolution-api    evoapicloud/evolution-api:v2.3.7
```

📌 **Anote/copie essa linha** — é o seu ponto de retorno. O nome do serviço (primeira coluna) e a imagem atual (segunda) são o que você vai usar no rollback.

Confirme também que há espaço para o build:

```bash
df -h / | tail -1
```
Precisa de pelo menos ~5 GB livres (você tem 54 GB usados de 400 GB, então está tranquilo).

---

## ETAPA 3 — Construir a imagem com o patch

Cole o bloco inteiro (são 4 comandos de uma vez):

```bash
rm -rf /root/evolution-patch
git clone https://github.com/basecorretora/evolution-api-patch.git /root/evolution-patch
cd /root/evolution-patch
docker build -t base-corretora/evolution-api:2.3.7-sync2 .
```

**O que vai acontecer:** o build passa por várias etapas e leva de **5 a 12 minutos**. Você verá linhas como `[builder 4/9] RUN git clone...`, `RUN npm ci --silent`, `RUN npm run build`.

### ⚠️ Os três pontos de atenção

**a) A linha do patch.** Procure por uma etapa `RUN git apply --verbose /tmp/basecorretora.patch`. O esperado é:
```
Checking patch src/api/dto/chat.dto.ts...
Applied patch src/api/dto/chat.dto.ts cleanly.
...
```
Se aparecer **`error: patch failed`** ou **`does not apply`** → **PARE e me avise**. Significa que o patch não casou com o código; não devemos seguir.

**b) A linha do patch da biblioteca.** Logo depois do `npm ci`, procure:
```
✔ estado: remoção órfã vira "pular", não erro
✔ estado: falha na recuperação não zera mais a versão válida
✔ contato: nome verificado de conta comercial passa a ser emitido

3/3 correções aplicadas no Baileys.
```
Se aparecer **`✖`** e o build parar → **PARE e me avise**. Significa que a
biblioteca mudou e o alvo precisa ser revisto (é proposital: melhor não subir).

**c) O fim do build.** Deve terminar com algo como:
```
Successfully tagged base-corretora/evolution-api:2.3.7-sync2
```
(ou, no builder novo, `=> naming to docker.io/base-corretora/evolution-api:2.3.7-sync2`)

**Conferir que a imagem existe:**
```bash
docker images | grep 2.3.7-sync2
```
Deve mostrar uma linha. Se não mostrar, o build não terminou — me mande o erro.

---

## ETAPA 4 — Trocar a imagem no EasyPanel

Volte ao painel da Hostinger (tela do print) → bloco **EasyPanel** → botão **`Gerenciar painel`** (abre o EasyPanel em outra aba).

Dentro do EasyPanel:

1. Abrir o projeto **`base_corretora`**
2. Clicar no serviço **`evolution-api`**
3. Ir na aba **`General`** (ou **`Source`**, dependendo da versão) — é onde aparece o campo da imagem Docker
4. No campo **Image**, substituir:

   | Trocar isto | Por isto |
   |---|---|
   | a imagem que estiver lá | `base-corretora/evolution-api:2.3.7-sync2` |

5. **Save** (Salvar)
6. **Deploy**

> Se o campo estiver dentro de uma seção chamada **Source** com opções (Github / Docker Image / Dockerfile), mantenha em **Docker Image** e só troque o texto da imagem.
> Se pedir usuário/senha de registry: **deixe em branco** — a imagem foi construída na própria máquina, não precisa baixar de lugar nenhum.

---

## ETAPA 5 — Conferir que subiu bem (~2 min depois do Deploy)

De volta ao **Web console**, cole:

```bash
docker service ls --format '{{.Name}}\t{{.Image}}\t{{.Replicas}}' | grep -i evolution
```
Esperado: a imagem agora é `base-corretora/evolution-api:2.3.7-sync2` e as réplicas `1/1`.

**A API responde?**
```bash
curl -s https://base-corretora-evolution-api.owu4ds.easypanel.host/ | head -c 160
```
Esperado: `{"status":200,"message":"Welcome to the Evolution API, it is working!","version":"2.3.7"...`

**As instâncias voltaram?** (pode levar 1–2 min)
```bash
curl -s https://base-corretora-evolution-api.owu4ds.easypanel.host/instance/fetchInstances \
  -H "apikey: Mj7acGwWXsLtUzEnCuaTDwOhFj3jCK0u" \
  | grep -o '"connectionStatus":"[a-z]*"' | sort | uniq -c
```
Esperado: a maioria em `"open"`.

**➡️ Me avise aqui.** Eu confirmo pelos logs, do meu lado, se o sinal de leitura passou a chegar preenchido — é a prova de que o patch pegou.

---

## ETAPA 6 — Teste de aceite (fazemos juntos)

1. Peça para alguém te mandar uma mensagem (ou mande de outro número)
2. O badge aparece no Berê Zap ✔
3. **Leia só no celular** → o badge deve sumir do Berê Zap em segundos
4. Mande outra mensagem e **leia só no Berê Zap** → o badge deve sumir do celular

Nos logs, o sinal muda de:
```
[CHATS-READ] Sem sinal de leitura — keys: ["remoteJid","instanceId"]     ← hoje
```
para:
```
[CHATS-READ] Sinal de leitura detectado: ... unreadCount=0                ← com o patch
```

---

### O que mais conferir depois (patches novos)

**Nome comercial:** peça para alguém te mandar mensagem de um número comercial
(ou espere a próxima) — o contato deve passar a exibir o NOME da empresa em vez
do número. Vale só para quem mandar mensagem depois do deploy; o histórico não
se corrige sozinho.

**Marcar como não lido:** no Berê Zap, marque uma conversa como não lida e veja
se a bolinha aparece no celular. Antes do patch isso não funcionava — nem pela
função original da Evolution.

---

## ETAPA 7 — Rollback (se qualquer coisa sair diferente)

**Pelo EasyPanel** (jeito certo, persistente):
serviço `evolution-api` → campo Image → voltar para `evoapicloud/evolution-api:v2.3.7` → Save → Deploy.

**Pelo terminal** (mais rápido, se precisar de urgência):
```bash
docker service update --image evoapicloud/evolution-api:v2.3.7 base_corretora_evolution-api
```
*(ajuste o nome do serviço se a ETAPA 2 mostrou outro)*

Nos dois casos: ~1 minuto, sem perda de dados. O patch **não altera banco** — não há nada mais a desfazer.

---

## Perguntas que podem surgir no meio

**"E se o build encher o disco?"** Você tem 346 GB livres; o build usa ~3 GB. Para limpar depois: `docker image prune -f`.

**"Posso fechar o Web console durante o build?"** Melhor não — se a conexão cair, o build morre no meio. Se acontecer, é só rodar o comando de novo (ele reaproveita o que já baixou).

**"As mensagens param durante o deploy?"** Sim, por 1–2 minutos, enquanto a Evolution reinicia. Fora do expediente, ninguém sente. Mensagens enviadas nesse intervalo ficam na fila e saem depois.

**"O que o patch NÃO resolve"** — para não criar expectativa errada: mensagens que já se perderam antes de hoje (precisa repescagem, trabalho separado), quedas de sessão do WhatsApp, e o passo 4 do teste (Berê Zap → celular) usa um caminho que teve bug conhecido no passado — é o item que mais precisa do teste real.
