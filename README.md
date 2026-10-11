# Sorteio do Casamento

App de pagina unica (sem build step) pra substituir o "sorteio da gravata" tradicional por uma dinamica digital: convidados doam pela lua de mel via Pix e ganham numeros da sorte como agradecimento.

- `index.html` / `app.js` / `pix.js` -- front-end estatico, sem dependencias de build.
- Banco de dados: Supabase (projeto `sorteio-casamento`), com RLS publica de leitura e escrita so via funcoes RPC (`claim_numbers`, `admin_update_config`, `admin_draw_winner`).
- Visao do convidado: `/` -- escolhe um pacote, escolhe os numeros, confirma, recebe QR Pix.
- Visao do organizador: `/#admin` -- protegida por uma chave (ver `admin_secrets` no banco), edita premio/precos/chave Pix e dispara o sorteio.
