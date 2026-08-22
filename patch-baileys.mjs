#!/usr/bin/env node
/**
 * Patch do Baileys 7.0.0-rc.9 (a versão que a Evolution 2.3.7 fixa).
 *
 * Roda DEPOIS do `npm ci`, sobre node_modules/baileys/lib — por isso não vai no
 * .patch do git: o alvo não é o código da Evolution, é a biblioteca por baixo.
 *
 * Cada correção exige que o trecho case EXATAMENTE. Se qualquer uma não casar,
 * o script sai com erro e o build FALHA — melhor não subir do que subir mudo,
 * que é justamente o defeito que estamos consertando.
 *
 * ── Correções ───────────────────────────────────────────────────────────────
 *
 * 1+2. "Marcar como lido/não lido responde sucesso e não faz nada"
 *      (Baileys issue #1406, reproduzida por terceiros nesta mesma versão)
 *
 *      Cadeia: o processamento de um pacote de estado lança erro quando uma
 *      remoção aponta para índice ausente → a recuperação grava a versão do
 *      estado como null → o próximo comando sai carimbado "versão 0" → o
 *      WhatsApp devolve conflito 409 DENTRO de um envelope "type=result" → o
 *      Baileys não abre o envelope e reporta sucesso.
 *      Efeito no Berê Zap: ler no site nunca apagava o badge do celular.
 *      A rc14 já corrigiu os dois pontos; aqui aplicamos só eles, sem arrastar
 *      8 meses de outras mudanças para dentro da Evolution 2.3.7.
 *
 * 3.   Nome de conta COMERCIAL nunca chega (633 contatos aparecendo como número)
 *
 *      O nome verificado de um business viaja em `verifiedBizName`, mas o
 *      evento que o carrega só é emitido quando `pushName` existe — e conta
 *      comercial vem com `pushName` VAZIO. A Evolution já sabe consumir o
 *      campo (`contact?.name ?? contact?.verifiedName`); o dado é que nunca
 *      chegava. Este ponto NÃO está corrigido nem na rc14 — é achado da casa.
 */
import fs from 'node:fs';

const BASE = 'node_modules/baileys/lib';
let aplicados = 0;

function patch(arquivo, descricao, de, para) {
  const caminho = `${BASE}/${arquivo}`;
  const original = fs.readFileSync(caminho, 'utf8');

  const ocorrencias = original.split(de).length - 1;
  if (ocorrencias !== 1) {
    console.error(`\n✖ ${descricao}`);
    console.error(`  ${caminho}: esperava 1 ocorrência do trecho, achei ${ocorrencias}.`);
    console.error('  O Baileys mudou. NÃO subir sem revisar o alvo.');
    process.exit(1);
  }

  fs.writeFileSync(caminho, original.replace(de, para));
  console.log(`✔ ${descricao}`);
  aplicados++;
}

// ── 1. não abortar o pacote de estado por uma remoção órfã ───────────────────
// O WhatsApp Web apenas registra aviso e segue; abortar aqui derruba todo o
// processamento e é o primeiro elo da cadeia do 409.
patch(
  'Utils/chat-utils.js',
  'estado: remoção órfã vira "pular", não erro',
  `                if (!prevOp) {
                    throw new Boom('tried remove, but no previous op', { data: { indexMac, valueMac } });
                }`,
  `                if (!prevOp) {
                    // [PATCH BASE CORRETORA] WA Web não lança aqui: registra aviso e pula.
                    // Lançar aborta o pacote inteiro e zera a versão do estado (ver fix 2).
                    return;
                }`,
);

// ── 2. preservar a versão do estado quando a recuperação falha ───────────────
// Gravar null faz o próximo comando sair como "versão 0", que o servidor
// rejeita com 409 — silenciosamente, porque o erro vem dentro de um "result".
patch(
  'Socket/chats.js',
  'estado: falha na recuperação não zera mais a versão válida',
  `                        await authState.keys.set({ 'app-state-sync-version': { [name]: null } });`,
  `                        // [PATCH BASE CORRETORA] zerar a versão aqui faz o próximo patch sair
                        // com version=0 → WhatsApp responde 409 dentro de um "type=result" →
                        // o Baileys reporta sucesso e nada acontece no aparelho.
                        if (isIrrecoverableError && states[name] && states[name].version) {
                            await authState.keys.set({ 'app-state-sync-version': { [name]: states[name] } });
                        }
                        else {
                            await authState.keys.set({ 'app-state-sync-version': { [name]: null } });
                        }`,
);

// ── 3. deixar o nome de conta comercial chegar ───────────────────────────────
patch(
  'Socket/chats.js',
  'contato: nome verificado de conta comercial passa a ser emitido',
  `        if (!!msg.pushName) {`,
  `        // [PATCH BASE CORRETORA] conta comercial vem com pushName VAZIO e o nome
        // real em verifiedBizName — sem isto o evento nunca era emitido e o
        // contato ficava exibido como número.
        if (!!msg.pushName || !!msg.verifiedBizName) {`,
);

console.log(`\n${aplicados}/3 correções aplicadas no Baileys.`);
