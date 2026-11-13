#!/usr/bin/env node
/**
 * Patch do Baileys 7.0.0-rc.9 — confirmar os avisos <status> do WhatsApp (LAB).
 *
 * ── O problema (ZAP-0079, visto em 13/11/2026) ──────────────────────────────
 *
 * O WhatsApp passou a mandar avisos <status> aos aparelhos vinculados e espera
 * uma confirmação (ack). A rc.9 não trata esse tipo de aviso: não confirma. O
 * servidor do WhatsApp então derruba a conexão ("stream errored out", com
 * <ack class="status"> no erro) e a instância reconecta num estado em que
 * aparece "open" mas deixa de funcionar direito. Medido: os 8 WhatsApps
 * conectados da frota caíram assim em 11 minutos (13/11 10:55–11:06) e o
 * laboratório caiu 77 vezes em 72 h (~1 a cada 50 min). Suspeita principal dos
 * WhatsApps que ficam "conectados mas não entregam".
 *
 * ── A correção ──────────────────────────────────────────────────────────────
 *
 * Igual à dos mantenedores da Evolution (ramo hotfix/baileys-status-ack,
 * commit 2f06ff24, 12/11/2026): um tratador que só confirma o <status>,
 * ligado tanto na conexão ao vivo (CB:status) quanto na fila de avisos
 * recebidos com a conexão fora (offline). Não toca em criptografia.
 *
 * Roda DEPOIS do `npm ci`, sobre node_modules/baileys/lib. Cada alvo precisa
 * casar EXATAMENTE 1 vez; senão o build FALHA (melhor não subir do que subir
 * diferente do revisado).
 */
import fs from 'node:fs';

const BASE = process.env.BAILEYS_LIB ?? 'node_modules/baileys/lib';
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

// 1. O tratador: só confirma o aviso de status
patch(
  'Socket/messages-recv.js',
  'status: tratador que confirma o aviso',
  '    const handleNotification = async (node) => {',
  '    const handleStatus = async (node) => {\n' +
  '        await sendMessageAck(node);\n' +
  '    };\n' +
  '    const handleNotification = async (node) => {'
);

// 2. Avisos que chegaram com a conexão fora (fila offline) também são confirmados
patch(
  'Socket/messages-recv.js',
  'status: confirmar também os avisos da fila offline',
  "            ['notification', handleNotification]\n        ]);",
  "            ['notification', handleNotification],\n" +
  "            ['status', handleStatus]\n" +
  '        ]);'
);

// 3. Avisos que chegam com a conexão ao vivo
patch(
  'Socket/messages-recv.js',
  'status: confirmar os avisos ao vivo (CB:status)',
  "    ws.on('CB:notification', async (node) => {\n" +
  "        await processNode('notification', node, 'handling notification', handleNotification);\n" +
  '    });',
  "    ws.on('CB:notification', async (node) => {\n" +
  "        await processNode('notification', node, 'handling notification', handleNotification);\n" +
  '    });\n' +
  "    ws.on('CB:status', async (node) => {\n" +
  "        await processNode('status', node, 'handling status', handleStatus);\n" +
  '    });'
);

console.log(`\n${aplicados} correção(ões) do status aplicada(s).`);
