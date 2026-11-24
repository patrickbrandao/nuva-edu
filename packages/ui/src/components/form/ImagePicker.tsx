import { ImageUp, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './form.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { cx } from '../feedback/layer';

/*
 * Seletor de imagem para o avatar (spec 007, "Avatar"; spec 029): aceita JPEG, PNG ou WebP,
 * recusa no navegador o arquivo acima do limite (5 MB) ou de outro tipo, e mostra a prévia
 * por endereço `blob:` com corte quadrado central (object-fit no CSS, sem `style`). O envio
 * é de quem usa: o componente só entrega o `File` escolhido. A CSP do site precisa aceitar
 * `blob:` em `img-src`.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;

/** Limite do avatar (spec 029): 5 MB. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Tipos aceitos (spec 029). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ImageRejection = 'too_large' | 'wrong_type';

/** Confere o arquivo contra os tipos e o limite; `null` quando serve. */
export function checkImageFile(
  file: Pick<File, 'size' | 'type'>,
  maxBytes: number = IMAGE_MAX_BYTES,
  types: readonly string[] = IMAGE_TYPES,
): ImageRejection | null {
  if (!types.includes(file.type)) return 'wrong_type';
  if (file.size > maxBytes) return 'too_large';
  return null;
}

export interface ImagePickerProps {
  /** Rótulo do grupo (ex.: "Foto de perfil"). */
  label: ReactNode;
  /** Texto do botão de escolher (ex.: "Escolher imagem"). */
  chooseLabel: string;
  /** Texto do botão quando já há imagem (ex.: "Trocar imagem"); padrão: `chooseLabel`. */
  changeLabel?: string | undefined;
  /** Texto do botão de remover; só aparece com `onRemove` e com imagem. */
  removeLabel?: string | undefined;
  /** Limite e tipos, sempre à vista (ex.: "JPEG, PNG ou WebP, até 5 MB"). */
  limitHint: ReactNode;
  /** Mensagens de recusa no navegador. */
  errors: { tooLarge: ReactNode; wrongType: ReactNode };
  /** Texto alternativo da prévia (ex.: "Prévia da foto de perfil"). */
  previewAlt: string;
  /** Arquivo aceito, ou `null` quando a pessoa remove a escolha. */
  onChange: (file: File | null) => void;
  /** Arquivo recusado, com o motivo (a mensagem já aparece no componente). */
  onReject?: ((reason: ImageRejection, file: File) => void) | undefined;
  /** Remover a imagem atual (ex.: `PUT /me/profile/avatar` com `null`). */
  onRemove?: (() => void) | undefined;
  /** Imagem que já existe (ex.: `avatarUrl` da sessão), mostrada até a pessoa escolher outra. */
  currentUrl?: string | null | undefined;
  /** O que aparece sem imagem (ex.: as iniciais do nome). */
  placeholder?: ReactNode;
  /** Erro de fora (ex.: o envio falhou). Tem prioridade sobre a recusa local. */
  error?: ReactNode;
  maxBytes?: number;
  types?: readonly string[];
  shape?: 'round' | 'square';
  disabled?: boolean;
  /** Envio em andamento: botões desabilitados e `aria-busy`. */
  busy?: boolean;
  className?: string | undefined;
}

/** Escolhe uma imagem, confere tipo e tamanho e mostra a prévia quadrada. */
export function ImagePicker({
  label,
  chooseLabel,
  changeLabel,
  removeLabel,
  limitHint,
  errors,
  previewAlt,
  onChange,
  onReject,
  onRemove,
  currentUrl,
  placeholder,
  error,
  maxBytes = IMAGE_MAX_BYTES,
  types = IMAGE_TYPES,
  shape = 'round',
  disabled = false,
  busy = false,
  className,
}: ImagePickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rejection, setRejection] = useState<ImageRejection | null>(null);

  // cada prévia `blob:` é liberada quando outra a substitui ou o componente sai
  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const problem = checkImageFile(file, maxBytes, types);
    if (problem) {
      setRejection(problem);
      onReject?.(problem, file);
      return;
    }
    setRejection(null);
    setPreviewUrl(URL.createObjectURL(file));
    onChange(file);
  };

  const shown = previewUrl ?? currentUrl ?? null;
  const message =
    error ??
    (rejection === 'too_large'
      ? errors.tooLarge
      : rejection === 'wrong_type'
        ? errors.wrongType
        : null);
  const off = disabled || busy;

  return (
    <fieldset
      aria-busy={busy || undefined}
      className={cx('minui-image-picker', message ? 'minui-image-picker--error' : null, className)}
    >
      <legend className="minui-adm-field__label minui-image-picker__legend">{label}</legend>
      <div className="minui-image-picker__row">
        <span className="minui-image-picker__frame" data-shape={shape}>
          {shown ? (
            <img className="minui-image-picker__img" src={shown} alt={previewAlt} />
          ) : (
            <span className="minui-image-picker__empty">{placeholder}</span>
          )}
        </span>
        <div className="minui-image-picker__side">
          <div className="minui-image-picker__actions">
            <AdminButton
              icon={<ImageUp aria-hidden="true" />}
              disabled={off}
              aria-describedby={`${id}-hint`}
              onClick={() => inputRef.current?.click()}
            >
              {shown ? (changeLabel ?? chooseLabel) : chooseLabel}
            </AdminButton>
            {onRemove && removeLabel && shown ? (
              <AdminButton
                variant="ghost"
                icon={<Trash2 aria-hidden="true" />}
                disabled={off}
                onClick={() => {
                  setPreviewUrl(null);
                  setRejection(null);
                  if (previewUrl) onChange(null);
                  onRemove();
                }}
              >
                {removeLabel}
              </AdminButton>
            ) : null}
          </div>
          <span id={`${id}-hint`} className="minui-adm-field__hint">
            {limitHint}
          </span>
          {message ? (
            <span role="alert" className="minui-image-picker__error">
              {message}
            </span>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        accept={types.join(',')}
        disabled={off}
        data-testid="image-picker-input"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          // a mesma escolha de novo também dispara `change`
          event.target.value = '';
        }}
      />
    </fieldset>
  );
}
