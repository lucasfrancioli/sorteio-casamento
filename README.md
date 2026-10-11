# Gravata Digital

App de pagina unica (sem build step) pra substituir o "sorteio da gravata" tradicional por uma dinamica digital: convidados doam e ganham numeros da sorte como agradecimento. Suporta VARIOS sorteios por evento, rodando em sequencia (um ativo por vez).

- `index.html` / `app.js` / `pix.js` -- front-end estatico, sem dependencias de build. Identidade visual preto e branco, inspirada em terno de noivo.
- Banco de dados: Supabase (projeto `sorteio-casamento`), com RLS publica de leitura e escrita so via funcoes RPC (`claim_numbers`, `admin_create_raffle`, `admin_update_raffle`, `admin_set_active_raffle`, `admin_draw_winner`, `admin_update_site_settings`).
- Imagens de premio: bucket publico `prize-images` no Supabase Storage.
- Visao do convidado: `/` -- mostra o sorteio ATIVO agora (escolhe pacote, escolhe numeros, confirma, recebe QR Pix); se nenhum estiver ativo, mostra o ultimo vencedor e a lista "a seguir".
- Visao do organizador: `/#admin` -- protegida por uma chave (ver `admin_secrets` no banco), cadastra sorteios (premio, imagem opcional, pacotes de preco), ativa um por vez e dispara o sorteio.
