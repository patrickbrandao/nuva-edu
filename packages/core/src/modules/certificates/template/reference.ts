// Referência do editor (`GET /certificate-templates/reference`, spec 015): as palavras-chave
// com descrição, valor de exemplo e obrigatoriedade, e o HTML do modelo inicial.

import {
  CERTIFICATE_QRCODE_KEY,
  CERTIFICATE_TEMPLATE_KEY_DESCRIPTIONS,
  CERTIFICATE_TEMPLATE_KEYS,
  CERTIFICATE_TEMPLATE_REQUIRED_KEYS,
  CERTIFICATE_TEMPLATE_VALIDATION_KEYS,
  type CertificateTemplateKey,
} from './keywords.ts';
import {
  type CertificatePreviewInput,
  type CertificateTemplateContext,
  certificatePreviewData,
  certificateTemplateValues,
} from './values.ts';

/**
 * Modelo inicial ("Começar do modelo"): A4 paisagem, fonte Inter (a da imagem do worker), todas
 * as palavras-chave e nenhuma imagem externa. Passa na própria validação (teste).
 */
export const CERTIFICATE_TEMPLATE_MODEL_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Certificado de conclusão</title>
<style>
@page { size: A4 landscape; margin: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: Inter, sans-serif; color: #1f2937; background: #ffffff; }
.pagina {
  box-sizing: border-box;
  width: 297mm;
  height: 210mm;
  padding: 16mm 22mm;
  border: 5mm solid #1e3a8a;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
}
.escola { margin: 0; font-size: 14pt; letter-spacing: 0.2em; text-transform: uppercase; color: #1e3a8a; }
h1 { margin: 4mm 0 0; font-size: 34pt; font-weight: 700; }
.texto { margin: 0; font-size: 14pt; line-height: 1.6; }
.nome { margin: 4mm 0; font-size: 28pt; font-weight: 600; color: #111827; }
.rodape { display: flex; align-items: flex-end; justify-content: space-between; text-align: left; }
.assinatura { width: 80mm; text-align: center; font-size: 11pt; }
.assinatura hr { border: 0; border-top: 0.4mm solid #374151; margin: 0 0 2mm; }
.assinatura p { margin: 0; }
.validacao { display: flex; align-items: flex-end; gap: 4mm; font-size: 9pt; color: #4b5563; }
.validacao p { margin: 0; line-height: 1.5; }
.qr svg { display: block; width: 26mm; height: 26mm; }
a { color: #1e3a8a; }
</style>
</head>
<body>
<div class="pagina">
  <header>
    <p class="escola">{{escola.nome}}</p>
    <h1>Certificado de conclusão</h1>
  </header>
  <main>
    <p class="texto">Certificamos que</p>
    <p class="nome">{{aluno.nome}}</p>
    <p class="texto">concluiu em {{certificado.data_conclusao}} o curso <strong>{{curso.titulo}}</strong>,<br>com carga horária de {{curso.carga_horaria}} horas.</p>
  </main>
  <footer class="rodape">
    <div class="assinatura">
      <hr>
      <p>{{assinatura.nome}}</p>
      <p>{{assinatura.cargo}}</p>
    </div>
    <div class="assinatura">
      <hr>
      <p>{{curso.instrutor}}</p>
      <p>Instrutor</p>
    </div>
    <div class="validacao">
      <p>Código {{certificado.codigo}}<br>Concluído em {{certificado.data_conclusao_curta}}<br>Emitido em {{certificado.data_emissao}}<br>Confira em <a href="{{certificado.url_validacao}}">{{certificado.url_validacao}}</a></p>
      <div class="qr">{{certificado.qrcode}}</div>
    </div>
  </footer>
</div>
</body>
</html>
`;

/** Uma palavra-chave na referência do editor. */
export interface CertificateTemplateKeyReference {
  key: CertificateTemplateKey;
  /** Como escrever no template: `{{aluno.nome}}`. */
  placeholder: string;
  description: string;
  /** Valor de exemplo, o mesmo do PDF de exemplo; o QR vem descrito, não em SVG. */
  example: string;
  /** Sempre obrigatória (`aluno.nome`, `curso.titulo`, `certificado.codigo`). */
  required: boolean;
  /** Verdadeiro nas duas que se alternam: o template precisa de ao menos uma delas. */
  requiredOneOf: boolean;
}

export interface CertificateTemplateReference {
  keys: CertificateTemplateKeyReference[];
  modelHtml: string;
}

const REQUIRED: ReadonlySet<string> = new Set(CERTIFICATE_TEMPLATE_REQUIRED_KEYS);
const ONE_OF: ReadonlySet<string> = new Set(CERTIFICATE_TEMPLATE_VALIDATION_KEYS);

/** Referência do editor, com os exemplos no idioma e no fuso da escola. */
export function certificateTemplateReference(
  input: CertificatePreviewInput & CertificateTemplateContext,
): CertificateTemplateReference {
  const values = certificateTemplateValues(certificatePreviewData(input), input);
  return {
    keys: CERTIFICATE_TEMPLATE_KEYS.map((key) => ({
      key,
      placeholder: `{{${key}}}`,
      description: CERTIFICATE_TEMPLATE_KEY_DESCRIPTIONS[key],
      example: key === CERTIFICATE_QRCODE_KEY ? 'Código QR (SVG) da URL de validação' : values[key],
      required: REQUIRED.has(key),
      requiredOneOf: ONE_OF.has(key),
    })),
    modelHtml: CERTIFICATE_TEMPLATE_MODEL_HTML,
  };
}
