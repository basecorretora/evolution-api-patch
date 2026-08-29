#!/usr/bin/env node
/**
 * Patch do Baileys 7.0.0-rc.9 — SOMENTE o nome de conta comercial (LAB).
 *
 * Recorte da correção 3 do patch-baileys.mjs completo (bancada). As correções
 * de app-state (1, 2, 1b, 1c) ficam DE FORA de propósito: relaxar a validação
 * de integridade do estado derrubou sessões da frota em 22-24/08 (provado por
 * rollback). Esta aqui não toca em criptografia nenhuma — só deixa um evento
 * ser emitido — e é o candidato seguro a ser testado no laboratório antes de
 * promover para a frota.
 *
 * ── A correção ──────────────────────────────────────────────────────────────
 *
 * Nome de conta COMERCIAL nunca chega (633 contatos aparecendo como número).
 * O nome verificado de um business viaja em `verifiedBizName`, mas o evento
 * que o carrega só é emitido quando `pushName` existe — e conta comercial vem
 * com `pushName` VAZIO. A Evolution já sabe consumir o campo
 * (`contact?.name ?? contact?.verifiedName`); o dado é que nunca chegava.
 * Não corrigido nem na rc14 — achado da casa.
 *
 * Roda DEPOIS do `npm ci`, sobre node_modules/baileys/lib. O alvo precisa
 * casar EXATAMENTE 1 vez; senão o build FALHA (melhor não subir do que subir
 * diferente do revisado).
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

// ── nome de conta comercial passa a ser emitido ─────────────────────────────
patch(
  'Socket/chats.js',
  'contato: nome verificado de conta comercial passa a ser emitido',
  `        if (!!msg.pushName) {`,
  `        // [PATCH BASE CORRETORA] conta comercial vem com pushName VAZIO e o nome
        // real em verifiedBizName — sem isto o evento nunca era emitido e o
        // contato ficava exibido como número.
        if (!!msg.pushName || !!msg.verifiedBizName) {`,
);

console.log(`\n${aplicados}/1 correção aplicada no Baileys (nome comercial — LAB).`);
