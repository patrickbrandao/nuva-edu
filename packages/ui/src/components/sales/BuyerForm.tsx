import type { FormEvent, ReactNode, Ref } from 'react';
import { useId } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './sales.css';
import type { Loose } from '../../index';
import {
  AdminButton as RawAdminButton,
  AdminField as RawAdminField,
} from '../admin/AdminControls.jsx';
import { cx } from '../feedback/layer';

/*
 * Dados do comprador (spec 011, RF-05): nome completo e CPF ou CNPJ, coletados no primeiro
 * checkout e reutilizados nos seguintes. Só apresentação: a validação por dígito verificador
 * e a normalização (guardar só dígitos) são do núcleo/API; o componente entrega o texto
 * digitado e mostra os erros que o site recebe. Sem endereço e sem telefone.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminField = RawAdminField as Loose<typeof RawAdminField>;

export type TaxIdType = 'cpf' | 'cnpj';

export interface BuyerData {
  fullName: string;
  taxIdType: TaxIdType;
  /** Documento como digitado (pode conter pontuação; a limpeza é do núcleo). */
  taxId: string;
}

export interface BuyerFieldsLabels {
  /** Título do grupo (ex.: "Dados do comprador"). */
  legend: string;
  fullName: string;
  fullNameHint?: ReactNode;
  /** Nome do grupo de tipo de documento (ex.: "Documento"). */
  taxIdType: string;
  cpf: string;
  cnpj: string;
  taxId: string;
  taxIdHint?: ReactNode;
}

export interface BuyerFieldsErrors {
  fullName?: ReactNode;
  taxId?: ReactNode;
}

export interface BuyerFieldsProps {
  value: BuyerData;
  onChange: (value: BuyerData) => void;
  labels: BuyerFieldsLabels;
  errors?: BuyerFieldsErrors | undefined;
  disabled?: boolean;
  className?: string | undefined;
}

/** Campos de nome completo e CPF/CNPJ, com o tipo de documento em rádio. */
export function BuyerFields({
  value,
  onChange,
  labels,
  errors,
  disabled = false,
  className,
}: BuyerFieldsProps) {
  const groupId = useId();
  const update = (patch: Partial<BuyerData>) => onChange({ ...value, ...patch });
  return (
    <fieldset className={cx('minui-buyer', className)} disabled={disabled}>
      <legend className="minui-buyer__legend">{labels.legend}</legend>
      <AdminField
        label={labels.fullName}
        hint={labels.fullNameHint}
        error={errors?.fullName}
        value={value.fullName}
        onChange={(fullName: string) => update({ fullName })}
        autoComplete="name"
        disabled={disabled}
        required
      />
      <div className="minui-buyer__types" role="radiogroup" aria-labelledby={`${groupId}-types`}>
        <span id={`${groupId}-types`} className="minui-adm-field__label">
          {labels.taxIdType}
        </span>
        <div className="minui-buyer__options">
          {(['cpf', 'cnpj'] as const).map((type) => (
            <label key={type} className="minui-buyer__option">
              <input
                type="radio"
                name={`${groupId}-tax-id-type`}
                value={type}
                checked={value.taxIdType === type}
                onChange={() => update({ taxIdType: type })}
              />
              <span>{type === 'cpf' ? labels.cpf : labels.cnpj}</span>
            </label>
          ))}
        </div>
      </div>
      <AdminField
        label={labels.taxId}
        hint={labels.taxIdHint}
        error={errors?.taxId}
        value={value.taxId}
        onChange={(taxId: string) => update({ taxId })}
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        required
      />
    </fieldset>
  );
}

export interface BuyerFormLabels extends BuyerFieldsLabels {
  submit: string;
  /** Texto do envio em andamento (ex.: "Salvando…"). */
  submitting?: string;
}

export interface BuyerFormProps {
  value: BuyerData;
  onChange: (value: BuyerData) => void;
  onSubmit: () => void;
  labels: BuyerFormLabels;
  errors?: BuyerFieldsErrors | undefined;
  /** Envio em andamento: campos e botão desabilitados. */
  pending?: boolean;
  /** Erro geral do envio (ex.: o 503 do provedor), anunciado como alerta. */
  error?: ReactNode;
  submitRef?: Ref<HTMLButtonElement> | undefined;
  className?: string | undefined;
}

/** Formulário dos dados do comprador, com o botão de continuar. */
export function BuyerForm({
  value,
  onChange,
  onSubmit,
  labels,
  errors,
  pending = false,
  error,
  submitRef,
  className,
}: BuyerFormProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending) onSubmit();
  };
  return (
    <form className={cx('minui-buyer-form', className)} onSubmit={submit} noValidate>
      <BuyerFields
        value={value}
        onChange={onChange}
        labels={labels}
        errors={errors}
        disabled={pending}
      />
      {error ? (
        <div role="alert" className="minui-buyer-form__error">
          {error}
        </div>
      ) : null}
      <AdminButton variant="primary" type="submit" disabled={pending} ref={submitRef}>
        {pending && labels.submitting ? labels.submitting : labels.submit}
      </AdminButton>
    </form>
  );
}
