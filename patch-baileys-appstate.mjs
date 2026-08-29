#!/usr/bin/env node
/**
 * Patch do Baileys 7.0.0-rc.9 — app-state (sincronização de "lido" com o celular) — LAB v2.
 *
 * Porta para o rc.9 o mecanismo que o Baileys rc14 usa (validações de
 * integridade INTACTAS). Roda depois do `npm ci`; cada alvo precisa casar
 * EXATAMENTE 1 vez, senão o build FALHA.
 *
 * Histórico:
 *  - v1 (29/08 manhã): fix 1 + "fix 2" = preservar a versão quando a recuperação
 *    falha. PROVADO no lab (teste inverso 3, 29/08 18:31): a ESCRITA passou a
 *    funcionar, mas o RECEBIMENTO travou — leitura feita no celular chegava em
 *    produção (sem patch) e NÃO chegava no lab. Motivo: o rc.9 só se recupera de
 *    estado corrompido zerando a versão (baixa snapshot do zero); o "fix 2"
 *    tirou o zerar sem pôr nada no lugar → coleção presa para sempre.
 *  - v2 (esta): em vez de zerar OU preservar, faz como o rc14: mantém a versão e
 *    FORÇA um snapshot completo na tentativa seguinte (`return_snapshot: true`).
 *    Recupera sem passar por version=0 (que era o elo do 409 na escrita).
 *
 * 1. `makeLtHashGenerator.mix()` lançava Boom em remoção órfã → abortava o
 *    pacote inteiro. WA Web/rc14 só pula; o descasamento de hash que sobra é
 *    tratado pela camada de validação (snapshot forçado).
 * 2a. `resyncAppState()`: conjunto `forceSnapshotCollections` (rc14).
 * 2b. Laço de resync: pede snapshot quando forçado OU quando sem versão (rc14).
 * 2c. catch: não zera mais a versão; falha recuperável → força snapshot na
 *     próxima volta; irrecuperável (2 tentativas / 404 / TypeError) → desiste
 *     mantendo a versão válida (rc14).
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

// ── 1. remoção órfã vira "pular", não erro (igual rc14) ────────────────────
patch(
  'Utils/chat-utils.js',
  'estado: remoção órfã vira "pular", não erro',
  `                if (!prevOp) {
                    throw new Boom('tried remove, but no previous op', { data: { indexMac, valueMac } });
                }`,
  `                if (!prevOp) {
                    // [PATCH BASE CORRETORA] WA Web/rc14 não lançam aqui: pulam a subtração.
                    // O descasamento de LTHash que sobra é tratado pela validação (snapshot forçado).
                    return;
                }`,
);

// ── 2a. conjunto de coleções que precisam de snapshot na próxima volta ──────
patch(
  'Socket/chats.js',
  'estado: conjunto forceSnapshotCollections (rc14)',
  `            const attemptsMap = {};
            // keep executing till all collections are done`,
  `            const attemptsMap = {};
            // [PATCH BASE CORRETORA] coleções que falharam e precisam de snapshot completo na
            // próxima tentativa — espelha o ErrorFatal → force snapshot do WA Web (rc14).
            const forceSnapshotCollections = new Set();
            // keep executing till all collections are done`,
);

// ── 2b. pedir snapshot quando forçado OU quando sem versão ─────────────────
patch(
  'Socket/chats.js',
  'estado: laço pede snapshot forçado após falha (rc14)',
  `                    states[name] = state;
                    logger.info(\`resyncing \${name} from v\${state.version}\`);
                    nodes.push({
                        tag: 'collection',
                        attrs: {
                            name,
                            version: state.version.toString(),
                            // return snapshot if being synced from scratch
                            return_snapshot: (!state.version).toString()
                        }
                    });`,
  `                    states[name] = state;
                    // [PATCH BASE CORRETORA] snapshot forçado após falha recuperável (rc14).
                    const shouldForceSnapshot = forceSnapshotCollections.has(name);
                    if (shouldForceSnapshot) {
                        forceSnapshotCollections.delete(name);
                    }
                    logger.info(\`resyncing \${name} from v\${state.version}\${shouldForceSnapshot ? ' (forcing snapshot)' : ''}\`);
                    nodes.push({
                        tag: 'collection',
                        attrs: {
                            name,
                            version: state.version.toString(),
                            // return snapshot if syncing from scratch or forcing after a failed attempt
                            return_snapshot: (shouldForceSnapshot || !state.version).toString()
                        }
                    });`,
);

// ── 2c. catch: nunca zera a versão; recuperável → snapshot; irrecuperável → desiste ──
patch(
  'Socket/chats.js',
  'estado: falha não zera versão — força snapshot (rc14)',
  `                    catch (error) {
                        // if retry attempts overshoot
                        // or key not found
                        const isIrrecoverableError = attemptsMap[name] >= MAX_SYNC_ATTEMPTS ||
                            error.output?.statusCode === 404 ||
                            error.name === 'TypeError';
                        logger.info({ name, error: error.stack }, \`failed to sync state from version\${isIrrecoverableError ? '' : ', removing and trying from scratch'}\`);
                        await authState.keys.set({ 'app-state-sync-version': { [name]: null } });
                        // increment number of retries
                        attemptsMap[name] = (attemptsMap[name] || 0) + 1;
                        if (isIrrecoverableError) {
                            // stop retrying
                            collectionsToHandle.delete(name);
                        }
                    }`,
  `                    catch (error) {
                        // [PATCH BASE CORRETORA] rc.9 zerava a versão aqui (version=null) e refazia
                        // do zero. Zerar é o elo do 409 na escrita (próximo patch sai com version=0
                        // e o WhatsApp responde 409 dentro de um "type=result"). O rc14 mantém a
                        // versão e força um snapshot completo na tentativa seguinte — recupera
                        // estado corrompido (LTHash) sem passar por version=0.
                        attemptsMap[name] = (attemptsMap[name] || 0) + 1;
                        const isIrrecoverableError = attemptsMap[name] >= MAX_SYNC_ATTEMPTS ||
                            error.output?.statusCode === 404 ||
                            error.name === 'TypeError';
                        const logData = { name, attempt: attemptsMap[name], version: states[name]?.version, error: error.stack };
                        if (isIrrecoverableError) {
                            logger.warn(logData, \`failed to sync \${name} from v\${states[name]?.version}, giving up (version kept)\`);
                            collectionsToHandle.delete(name);
                        }
                        else {
                            logger.info(logData, \`failed to sync \${name} from v\${states[name]?.version}, forcing snapshot retry\`);
                            forceSnapshotCollections.add(name);
                        }
                    }`,
);

// ── 3. DIAGNÓSTICO (lab): ao falhar a assinatura de um patch, dizer QUAL ───────
//     keyId, versão, nº de mutações, se veio "external". Sem isso o log só diz
//     "Invalid patch mac" e não dá pra saber se é chave ausente/velha ou pacote.
patch(
  'Utils/chat-utils.js',
  'diagnóstico: contexto do patch quando a assinatura falha',
  `        const decodeResult = await decodeSyncdPatch(syncd, name, newState, getAppStateSyncKey, shouldMutate
            ? mutation => {
                const index = mutation.syncAction.index?.toString();
                mutationMap[index] = mutation;
            }
            : () => { }, true);`,
  `        let decodeResult;
        try {
            decodeResult = await decodeSyncdPatch(syncd, name, newState, getAppStateSyncKey, shouldMutate
                ? mutation => {
                    const index = mutation.syncAction.index?.toString();
                    mutationMap[index] = mutation;
                }
                : () => { }, true);
        }
        catch (err) {
            // [PATCH BASE CORRETORA — LAB] contexto do patch que falhou
            const keyIdB64 = syncd.keyId?.id ? Buffer.from(syncd.keyId.id).toString('base64') : null;
            let haveKey = null;
            try { haveKey = !!(keyIdB64 && await getAppStateSyncKey(keyIdB64)); } catch { haveKey = 'erro'; }
            logger?.warn({ name, version: patchVersion, keyId: keyIdB64, haveKey, mutations: syncd.mutations?.length ?? 0, external: !!syncd.externalMutations, snapshotMac: syncd.snapshotMac ? Buffer.from(syncd.snapshotMac).toString('base64') : null }, 'DIAG app-state: falha ao decodificar patch');
            throw err;
        }`,
);

console.log(`\n${aplicados}/5 correções de app-state aplicadas no Baileys (LAB v2.1 — porta do rc14 + diagnóstico, validações intactas).`);
