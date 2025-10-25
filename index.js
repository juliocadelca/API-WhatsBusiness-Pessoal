// --- Importações das bibliotecas ---
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');

// --- Configuração (MUDE A URL) ---
// Cole aqui a URL do seu Webhook do Make.com
// const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/818di4sak9mh36myeojo0ie512skm49f';
const MAKE_WEBHOOK_URL = 'https://hook.us1.make.com/bh1atreubsqriyscqwn8grj5w7qjcc9j';
const LISTEN_PORT = 3000; // Porta que o PC vai usar
// --- Fim da Configuração ---

// Inicializa o servidor Express (para receber respostas do Make)
const app = express();

// Inicializa o Cliente do WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Salva sua sessão para não escanear o QR toda vez
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necessário para rodar
    }
});

// Evento 1: Gerar o QR Code
client.on('qr', qr => {
    console.log('--------------------------------------------------');
    console.log('QR Code Recebido! Escaneie com seu WhatsApp Business:');
    qrcode.generate(qr, { small: true });
    console.log('--------------------------------------------------');
});

// Evento 2: Cliente pronto
client.on('ready', () => {
    console.log('✅ Cliente do WhatsApp está PRONTO!');
});

// Evento 3: Mensagem Recebida (Envia para o Make.com)
client.on('message', async msg => {
    // Ignora mensagens de status, grupos, etc.
    if (msg.from === 'status@broadcast' || msg.isStatus) {
        return;
    }

    try {
        console.log(`Mensagem recebida de ${msg.from}: ${msg.body}`);

        // Envia os dados para o Webhook do Make.com
        await axios.post(MAKE_WEBHOOK_URL, {
            chatId: msg.from, // Número do cliente (ex: 55349..._@c.us)
            message: msg.body  // O texto da mensagem
        });

    } catch (err) {
        console.error('❌ Erro ao enviar para o Make.com:', err.message);
    }
});

const getRawBody = require('raw-body');

// Rota 1: Receber a resposta do Make.com (Envia para o Cliente)
app.post('/send-message', async (req, res) => {
    try {
        // 1. Ler o corpo RAW como texto
        const rawBodyBuffer = await getRawBody(req, {
            length: req.headers['content-length'],
            limit: '1mb',
            encoding: 'utf-8' // Importante!
        });
        const rawBodyText = rawBodyBuffer.toString();

        // 2. Tentar corrigir o JSON manualmente (escapar aspas problemáticas)
        // Esta é a "gambiarra" para o bug do Make.com
        // Cuidado: pode falhar se a mensagem tiver estruturas JSON complexas dentro dela.
        let fixedBodyText = rawBodyText;
         // Tenta corrigir aspas dentro da string "message"
        fixedBodyText = fixedBodyText.replace(/"message":\s*"(.*)"\s*}/s, (match, messageContent) => {
            const escapedMessage = messageContent.replace(/"/g, '\\"'); // Escapa as aspas
            return `"message": "${escapedMessage}"}`; 
        });


        // 3. Tentar parsear o JSON corrigido
        let data;
        try {
             data = JSON.parse(fixedBodyText);
        } catch (jsonError) {
             console.error('❌ ERRO CRÍTICO: Não foi possível parsear o JSON mesmo após correção:', jsonError);
             console.error('--- Corpo Recebido (Raw): ---');
             console.error(rawBodyText); // Mostra o que veio do Make
             console.error('--- Corpo Tentado Corrigir: ---');
             console.error(fixedBodyText); // Mostra como ficou a tentativa
             return res.status(400).send({ error: 'JSON mal formatado recebido do Make.com.' });
        }

        const { chatId, message } = data; // Extrai chatId e message do JSON corrigido

        if (!chatId || !message) {
            console.warn('Recebido e parseado do Make.com, mas faltou chatId ou message');
            return res.status(400).send({ error: 'chatId e message são obrigatórios.' });
        }

        // 4. Formatar a mensagem para o WhatsApp (trocar \\n por \n)
        const formattedMessage = message.replace(/\\n/g, '\n');

        // 5. Enviar para o WhatsApp
        await client.sendMessage(chatId, formattedMessage); 
        console.log(`Resposta enviada para ${chatId}: ${formattedMessage}`);
        res.status(200).send({ success: true });

    } catch (err) {
        console.error('❌ Erro GERAL na rota /send-message:', err.message);
        res.status(500).send({ error: 'Erro interno no servidor gateway.' });
    }
});

// --- Inicia tudo ---
client.initialize();
app.listen(LISTEN_PORT, () => {
    console.log(`==================================================`);
    console.log(`✅ Gateway "Novo-Oficial" rodando!`);
    console.log(`Escutando por respostas do Make.com na porta ${LISTEN_PORT}`);
    console.log(`Execute o ngrok no outro terminal: ngrok http ${LISTEN_PORT}`);
    console.log(`==================================================`);
});