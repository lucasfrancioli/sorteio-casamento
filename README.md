# Gravata Digital

App de pagina unica (sem build step) pra substituir o "sorteio da gravata" tradicional por uma dinamica digital: convidados doam e ganham numeros da sorte como agradecimento. Suporta VARIOS sorteios por evento, rodando em sequencia (um ativo por vez), e cada sorteio pode ter VARIOS itens/premios, sorteados um de cada vez a partir do mesmo pool de doacoes.

- `index.html` / `app.js` / `pix.js` -- front-end estatico, sem dependencias de build. Identidade visual preto e branco, inspirada em terno de noivo.
- Banco de dados: Supabase (projeto `sorteio-casamento`), com RLS publica de leitura e escrita so via funcoes RPC (`claim_numbers`, `admin_create_raffle`, `admin_update_raffle`, `admin_set_active_raffle`, `admin_draw_item_winner`, `admin_update_site_settings`).
- `raffles` guarda o pool de doacao (pacotes de preco, quantidade de numeros, status); `raffle_items` guarda cada premio individual daquele sorteio (descricao, imagem opcional, numero vencedor). Um numero que ja ganhou um item fica fora do sorteio dos itens seguintes do mesmo `raffle`.
- Imagens de premio: bucket publico `prize-images` no Supabase Storage.
- Visao do convidado: `/` -- mostra o sorteio ATIVO agora (lista os itens, escolhe pacote, escolhe numeros, confirma, recebe QR Pix); se nenhum estiver ativo, mostra os vencedores do ultimo sorteio e a lista "a seguir".
- Visao do organizador: `/#admin` -- protegida por uma chave (ver `admin_secrets` no banco), cadastra sorteios com um ou mais itens (cada um com imagem opcional), pacotes de preco, ativa um sorteio por vez e sorteia os itens individualmente, em sequencia.
