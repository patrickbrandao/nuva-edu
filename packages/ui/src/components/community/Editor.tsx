import { countMarkdownCharacters, MARKDOWN_BODY_MAX_LENGTH } from '@nuva-edu/core/markdown';
import { Eye, PencilLine } from 'lucide-react';
import {
  type KeyboardEvent,
  type KeyboardEventHandler,
  type ReactNode,
  useId,
  useState,
} from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './community.css';
import { MarkdownPreview } from '../catalog/Markdown';

/*
 * Editor de Markdown com prévia (spec 006, "Base técnica"; spec 017, RF-05; ADR 0027).
 *
 * O texto é o Markdown em edição; a prévia é desenhada pelo `MarkdownPreview` da 627, que
 * usa o mesmo pipeline da gravação — então tudo o que aparece na prévia passa pela
 * higienização do núcleo, inclusive `<script>` e `javascript:` escritos pela pessoa. O
 * componente não grava nada, não conhece HTTP e não aplica regra de negócio: recebe o
 * texto, devolve o texto.
 *
 * O contador soma os caracteres do Markdown (o mesmo `countMarkdownCharacters` da API),
 * fica anunciado em `aria-live="polite"` e marca o excesso com `aria-invalid` — o limite
 * é o do recurso, que o site passa; o padrão é o do corpo de fórum (20.000, spec 017).
 */

export interface MarkdownEditorLabels {
  /** Rótulo do campo de texto (ex.: "Sua resposta"). */
  label: string;
  /** Nome do botão que abre a prévia (ex.: "Prévia"). */
  showPreview: string;
  /** Nome do botão que volta a escrever (ex.: "Escrever"). */
  hidePreview: string;
  /** Nome da região da prévia para o leitor de tela. */
  previewRegion: string;
  /** Texto da prévia quando não há nada escrito. */
  emptyPreview: string;
  /** Contador, ex.: (120, 20000) => "120 de 20.000 caracteres". */
  counter: (used: number, max: number) => string;
  /** Aviso de excesso; sem ele, o contador já avisa pelo destaque. */
  overLimit?: (max: number) => ReactNode;
  /** Dica abaixo do campo. */
  hint?: ReactNode;
  /** Erro do envio, já traduzido. */
  error?: ReactNode;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  labels: MarkdownEditorLabels;
  /** Limite de caracteres do recurso (padrão: 20.000, o do corpo de fórum). */
  maxLength?: number;
  rows?: number;
  id?: string;
  name?: string;
  placeholder?: string | undefined;
  disabled?: boolean;
  required?: boolean;
  /** Texto lido depois de um link da prévia (ex.: "abre em nova aba"). */
  newTabLabel?: string | undefined;
  /** Texto acessível de imagem sem `alt` (ADR 0027). */
  missingAltLabel?: string | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement> | undefined;
  /** Id da lista de menções que o campo controla (o foco permanece no textarea). */
  ariaControls?: string | undefined;
  className?: string | undefined;
}

/** Editor de Markdown com contador e prévia segura. */
export function MarkdownEditor({
  value,
  onChange,
  labels,
  maxLength = MARKDOWN_BODY_MAX_LENGTH,
  rows = 6,
  id,
  name,
  placeholder,
  disabled = false,
  required = false,
  newTabLabel,
  missingAltLabel,
  onKeyDown,
  ariaControls,
  className,
}: MarkdownEditorProps) {
  const generatedId = useId();
  const fieldId = id ?? `${generatedId}-markdown`;
  const counterId = `${fieldId}-counter`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const previewId = `${fieldId}-preview`;
  const [preview, setPreview] = useState(false);

  const used = countMarkdownCharacters(value);
  const over = used > maxLength;
  const describedBy = [counterId, labels.hint ? hintId : null, labels.error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  const toggle = () => setPreview((current) => !current);
  const onToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // O botão é um toggle comum; Enter e espaço já são nativos. Esc volta a escrever.
    if (event.key === 'Escape' && preview) {
      event.preventDefault();
      setPreview(false);
    }
  };

  return (
    <div className={['minui-md-editor', className].filter(Boolean).join(' ')}>
      <label className="minui-md-editor__label" htmlFor={fieldId}>
        {labels.label}
        {required ? <span className="minui-md-editor__required"> *</span> : null}
      </label>
      <div className="minui-md-editor__frame" data-preview={preview ? 'true' : undefined}>
        {preview ? (
          <section
            id={previewId}
            aria-label={labels.previewRegion}
            aria-live="polite"
            className="minui-md-editor__preview"
          >
            {value.trim() ? (
              <MarkdownPreview
                markdown={value}
                newTabLabel={newTabLabel}
                missingAltLabel={missingAltLabel}
              />
            ) : (
              <p className="minui-md-editor__empty">{labels.emptyPreview}</p>
            )}
          </section>
        ) : (
          <textarea
            id={fieldId}
            name={name}
            value={value}
            rows={rows}
            disabled={disabled}
            required={required}
            placeholder={placeholder}
            aria-invalid={over || labels.error ? true : undefined}
            aria-describedby={describedBy}
            aria-controls={ariaControls}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            className="minui-md-editor__input"
          />
        )}
      </div>
      <div className="minui-md-editor__foot">
        <span
          id={counterId}
          className="minui-md-editor__counter"
          aria-live="polite"
          data-over={over ? 'true' : undefined}
        >
          {labels.counter(used, maxLength)}
        </span>
        <button
          type="button"
          className="minui-md-editor__toggle"
          aria-expanded={preview}
          aria-controls={preview ? previewId : fieldId}
          disabled={disabled}
          onClick={toggle}
          onKeyDown={onToggleKeyDown}
        >
          {preview ? <PencilLine aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {preview ? labels.hidePreview : labels.showPreview}
        </button>
      </div>
      {over && labels.overLimit ? (
        <p className="minui-md-editor__error" role="alert">
          {labels.overLimit(maxLength)}
        </p>
      ) : null}
      {labels.hint ? (
        <p id={hintId} className="minui-md-editor__hint">
          {labels.hint}
        </p>
      ) : null}
      {labels.error ? (
        <p id={errorId} className="minui-md-editor__error" role="alert">
          {labels.error}
        </p>
      ) : null}
    </div>
  );
}
