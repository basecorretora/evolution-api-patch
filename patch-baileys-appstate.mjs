#!/usr/bin/env node
/**
 * Patch do Baileys 7.0.0-rc.9 — app-state (escrita de "lido" no celular) — LAB.
 *
 * SOMENTE os 2 fixes "estilo rc14" (validações de integridade INTACTAS).
 * As correções 1b/1c (relaxar validação) ficam FORA: derrubaram sessões da
 * frota em 22-24/08. Este script é a via (a) do plano de laboratório:
 * fixes mínimos numa sessão FRESCA. Roda depois do `npm ci`; alvo precisa
 * casar EXATAMENTE 1 vez, senão o build FALHA.
 *
 * 1. `makeLtHashGenerator.mix()` lançava Boom em remoção órfã → abortava o
 *    pacote de estado inteiro (elo 1 da cadeia do 409). WA Web só avisa e pula.
 * 2. `resyncAppState()` gravava app-state-sync-version=null ao falhar →
 *    próximo comando saía com version=0 → WhatsApp devolve 409 DENTRO de um
 *    type=result → Baileys reporta sucesso e nada acontece no aparelho.
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

// ── 1. remoção órfã vira "pular", não erro ──────────────────────────────────
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

// ── 2. preservar a versão do estado quando a recuperação falha ─────────────
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

console.log(`\n${aplicados}/2 correções de app-state aplicadas no Baileys (LAB, validações intactas).`);
