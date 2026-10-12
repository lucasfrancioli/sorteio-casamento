// Gerador de "Pix Copia e Cola" (BR Code, padrao EMV) -- 100% local no navegador,
// sem chamar nenhuma API externa com a chave Pix. So monta a string formatada
// e calcula o CRC16 (mesmo algoritmo que todo app de banco usa pra validar).
// Referencia: manual "BR Code" do Banco Central (EMV QR Code Pix estatico,
// com valor fixo).

function pixField(id, value) {
  const len = String(value.length).padStart(2, "0");
  return `${id}${len}${value}`;
}

// Remove acentos/caracteres fora do padrao ASCII exigido pelo campo (nome/cidade).
function pixSanitize(text, maxLen) {
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim();
  return normalized.slice(0, maxLen) || "NA";
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Normaliza a chave Pix pro formato exato que o BR Code exige (senao o banco
// recebedor rejeita o QR como "invalido", mesmo com o resto do payload certo).
// Ex real que quebrou: "19 99852-3323" digitado como celular -> precisa virar "+5519998523323".
function normalizePixKey(rawKey, keyType) {
  const key = (rawKey || "").trim();
  const type = (keyType || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

  if (type === "celular" || type === "telefone" || type === "phone") {
    let digits = key.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) {
      // ja tem DDI
    } else {
      digits = "55" + digits;
    }
    return "+" + digits;
  }

  if (type === "cpf" || type === "cnpj") {
    return key.replace(/\D/g, "");
  }

  // email e chave aleatoria (evp) vao como digitadas, so sem espacos nas pontas
  return key;
}

/**
 * Monta o payload Pix "copia e cola" com valor fixo.
 * @param {{pixKey: string, amount: number, merchantName: string, merchantCity: string, txid?: string}} opts
 */
function buildPixPayload({ pixKey, amount, merchantName, merchantCity, txid }) {
  const gui = pixField("00", "br.gov.bcb.pix");
  const key = pixField("01", pixKey.trim());
  const merchantAccountInfo = pixField("26", gui + key);

  const mcc = pixField("52", "0000");
  const currency = pixField("53", "986");
  const amountField = pixField("54", amount.toFixed(2));
  const country = pixField("58", "BR");
  const name = pixField("59", pixSanitize(merchantName, 25));
  const city = pixField("60", pixSanitize(merchantCity, 15));

  const referenceLabel = pixField("05", (txid || "***").slice(0, 25));
  const additionalData = pixField("62", referenceLabel);

  const payloadFormat = pixField("00", "01");

  const withoutCrc =
    payloadFormat +
    merchantAccountInfo +
    mcc +
    currency +
    amountField +
    country +
    name +
    city +
    additionalData +
    "6304";

  const crc = crc16(withoutCrc);
  return withoutCrc + crc;
}
